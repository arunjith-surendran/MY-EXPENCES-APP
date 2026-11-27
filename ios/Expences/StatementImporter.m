#import <CommonCrypto/CommonCrypto.h>
#import <CommonCrypto/CommonKeyDerivation.h>
#import <PDFKit/PDFKit.h>
#import <Security/Security.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

/**
 * Lets the user pick a bank statement (PDF, CSV or text) and returns its text.
 * Everything happens on the device; the file is copied to a temp folder and read with PDFKit.
 *
 *   pick()                    -> { name, path } or null if cancelled
 *   extractText(path, pass?)  -> text; rejects with code "PASSWORD" if the PDF is locked
 *                                 and no (or a wrong) password was given.
 *   extractRawText(path, pass?) -> the PDF's text in PDFKit's own order (the old reader, a fallback)
 *   pickBackup()              -> { name, path } of a .json backup, or null if cancelled
 *   writeFile(name, text)     -> path of a new file with that text in the temp folder
 *   encrypt(text, password)   -> { salt, iv, data, mac, iter } (base64), AES-256-CBC + HMAC-SHA256
 *   decrypt(box, password)    -> text; rejects with code "PASSWORD" if it's wrong
 */
@interface StatementImporter : NSObject <RCTBridgeModule, UIDocumentPickerDelegate>
@property(nonatomic, copy) RCTPromiseResolveBlock pickResolve;
@property(nonatomic, copy) RCTPromiseRejectBlock pickReject;
@end

@implementation StatementImporter

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(pick : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [self presentPickerFor:@[ UTTypePDF, UTTypeCommaSeparatedText, UTTypePlainText ]
                 resolve:resolve
                  reject:reject];
}

RCT_EXPORT_METHOD(pickBackup : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [self presentPickerFor:@[ UTTypeJSON, UTTypePlainText ] resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(writeFile
                  : (NSString *)name text
                  : (NSString *)text resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  NSString *safe = [[name componentsSeparatedByCharactersInSet:
                              [NSCharacterSet characterSetWithCharactersInString:@"/\\:"]]
      componentsJoinedByString:@"-"];
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:safe];
  NSError *error = nil;
  if (![text writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:&error]) {
    reject(@"WRITE", error.localizedDescription ?: @"Couldn't write the file.", error);
    return;
  }
  resolve(path);
}

static const NSUInteger kIterations = 200000;

/** 64 bytes from the password: the first 32 encrypt, the last 32 sign. */
static NSData *DeriveKeys(NSString *password, NSData *salt, NSUInteger iterations)
{
  NSData *pw = [password dataUsingEncoding:NSUTF8StringEncoding];
  NSMutableData *key = [NSMutableData dataWithLength:64];
  CCKeyDerivationPBKDF(kCCPBKDF2, pw.bytes, pw.length, salt.bytes, salt.length,
                       kCCPRFHmacAlgSHA256, (uint)iterations, key.mutableBytes, key.length);
  return key;
}

static NSData *Hmac(NSData *key, NSData *iv, NSData *data)
{
  NSMutableData *mac = [NSMutableData dataWithLength:CC_SHA256_DIGEST_LENGTH];
  CCHmacContext ctx;
  CCHmacInit(&ctx, kCCHmacAlgSHA256, key.bytes, key.length);
  CCHmacUpdate(&ctx, iv.bytes, iv.length);
  CCHmacUpdate(&ctx, data.bytes, data.length);
  CCHmacFinal(&ctx, mac.mutableBytes);
  return mac;
}

static NSData *Aes(CCOperation op, NSData *key, NSData *iv, NSData *input)
{
  NSMutableData *out = [NSMutableData dataWithLength:input.length + kCCBlockSizeAES128];
  size_t moved = 0;
  CCCryptorStatus status =
      CCCrypt(op, kCCAlgorithmAES, kCCOptionPKCS7Padding, key.bytes, kCCKeySizeAES256, iv.bytes,
              input.bytes, input.length, out.mutableBytes, out.length, &moved);
  if (status != kCCSuccess) return nil;
  out.length = moved;
  return out;
}

static NSData *RandomBytes(NSUInteger n)
{
  NSMutableData *d = [NSMutableData dataWithLength:n];
  if (SecRandomCopyBytes(kSecRandomDefault, n, d.mutableBytes) != errSecSuccess) return nil;
  return d;
}

RCT_EXPORT_METHOD(encrypt
                  : (NSString *)text password
                  : (NSString *)password resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSData *salt = RandomBytes(16), *iv = RandomBytes(16);
    if (!salt || !iv) {
      reject(@"CRYPTO", @"Couldn't encrypt the backup.", nil);
      return;
    }
    NSData *keys = DeriveKeys(password, salt, kIterations);
    NSData *encKey = [keys subdataWithRange:NSMakeRange(0, 32)];
    NSData *macKey = [keys subdataWithRange:NSMakeRange(32, 32)];
    NSData *cipher = Aes(kCCEncrypt, encKey, iv, [text dataUsingEncoding:NSUTF8StringEncoding]);
    if (!cipher) {
      reject(@"CRYPTO", @"Couldn't encrypt the backup.", nil);
      return;
    }
    resolve(@{
      @"salt" : [salt base64EncodedStringWithOptions:0],
      @"iv" : [iv base64EncodedStringWithOptions:0],
      @"data" : [cipher base64EncodedStringWithOptions:0],
      @"mac" : [Hmac(macKey, iv, cipher) base64EncodedStringWithOptions:0],
      @"iter" : @(kIterations),
    });
  });
}

RCT_EXPORT_METHOD(decrypt
                  : (NSDictionary *)box password
                  : (NSString *)password resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSData *salt = [[NSData alloc] initWithBase64EncodedString:box[@"salt"] ?: @"" options:0];
    NSData *iv = [[NSData alloc] initWithBase64EncodedString:box[@"iv"] ?: @"" options:0];
    NSData *cipher = [[NSData alloc] initWithBase64EncodedString:box[@"data"] ?: @"" options:0];
    NSData *mac = [[NSData alloc] initWithBase64EncodedString:box[@"mac"] ?: @"" options:0];
    NSUInteger iterations = [box[@"iter"] unsignedIntegerValue] ?: kIterations;
    if (salt.length != 16 || iv.length != 16 || !cipher || mac.length != CC_SHA256_DIGEST_LENGTH) {
      reject(@"READ", @"This backup is damaged.", nil);
      return;
    }
    NSData *keys = DeriveKeys(password, salt, iterations);
    NSData *encKey = [keys subdataWithRange:NSMakeRange(0, 32)];
    NSData *macKey = [keys subdataWithRange:NSMakeRange(32, 32)];
    // Constant-time compare, so a wrong password can't be guessed byte by byte.
    NSData *expected = Hmac(macKey, iv, cipher);
    const uint8_t *a = expected.bytes, *b = mac.bytes;
    uint8_t diff = 0;
    for (NSUInteger i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) diff |= a[i] ^ b[i];
    if (diff != 0) {
      reject(@"PASSWORD", @"Wrong password.", nil);
      return;
    }
    NSData *plain = Aes(kCCDecrypt, encKey, iv, cipher);
    NSString *text = plain ? [[NSString alloc] initWithData:plain encoding:NSUTF8StringEncoding] : nil;
    if (!text) {
      reject(@"READ", @"This backup is damaged.", nil);
      return;
    }
    resolve(text);
  });
}

- (void)presentPickerFor:(NSArray<UTType *> *)types
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.pickResolve != nil) {
      reject(@"BUSY", @"A file picker is already open.", nil);
      return;
    }
    self.pickResolve = resolve;
    self.pickReject = reject;

    UIDocumentPickerViewController *picker =
        [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:types asCopy:YES];
    picker.delegate = self;
    picker.allowsMultipleSelection = NO;
    [RCTPresentedViewController() presentViewController:picker animated:YES completion:nil];
  });
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller
    didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  NSURL *url = urls.firstObject;
  RCTPromiseResolveBlock resolve = self.pickResolve;
  self.pickResolve = nil;
  self.pickReject = nil;
  if (url == nil || resolve == nil) {
    if (resolve) resolve([NSNull null]);
    return;
  }
  // asCopy:YES already gives us a private copy we can keep reading after the picker closes.
  resolve(@{@"name" : url.lastPathComponent ?: @"statement", @"path" : url.path});
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  RCTPromiseResolveBlock resolve = self.pickResolve;
  self.pickResolve = nil;
  self.pickReject = nil;
  if (resolve) resolve([NSNull null]);
}

RCT_EXPORT_METHOD(extractText
                  : (NSString *)path password
                  : (NSString *)password resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  [self readPath:path password:password layout:YES resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(extractRawText
                  : (NSString *)path password
                  : (NSString *)password resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  [self readPath:path password:password layout:NO resolve:resolve reject:reject];
}

/**
 * The page's text rebuilt line by line from where each character sits, so a table row
 * ("05/11/2026  CARREFOUR  45.00  1,234.56") comes out as one line even when the PDF
 * stores its columns separately (PDFKit's `string` then lists all dates, then all amounts).
 */
static NSString *LayoutText(PDFPage *page)
{
  NSString *s = page.string;
  NSUInteger n = s.length;
  if (n == 0) return @"";

  typedef struct {
    CGFloat x, w, midY, h;
    NSUInteger index;
  } Glyph;
  Glyph *glyphs = malloc(sizeof(Glyph) * n);
  NSUInteger count = 0;
  NSCharacterSet *space = [NSCharacterSet whitespaceAndNewlineCharacterSet];
  for (NSUInteger i = 0; i < n; i++) {
    if ([space characterIsMember:[s characterAtIndex:i]]) continue;
    CGRect b = [page characterBoundsAtIndex:(NSInteger)i];
    if (CGRectIsEmpty(b) || CGRectIsNull(b)) continue;
    glyphs[count++] = (Glyph){CGRectGetMinX(b), CGRectGetWidth(b), CGRectGetMidY(b),
                              CGRectGetHeight(b), i};
  }
  if (count == 0) {
    free(glyphs);
    return s;
  }

  // Top of the page first (PDF y grows upwards), then left to right.
  NSMutableArray<NSValue *> *order = [NSMutableArray arrayWithCapacity:count];
  for (NSUInteger i = 0; i < count; i++) [order addObject:@(i)];
  [order sortUsingComparator:^NSComparisonResult(NSNumber *a, NSNumber *b) {
    Glyph ga = glyphs[a.unsignedIntegerValue], gb = glyphs[b.unsignedIntegerValue];
    if (fabs(ga.midY - gb.midY) > MIN(ga.h, gb.h) * 0.5) {
      return ga.midY > gb.midY ? NSOrderedAscending : NSOrderedDescending;
    }
    return ga.x < gb.x ? NSOrderedAscending : (ga.x > gb.x ? NSOrderedDescending : NSOrderedSame);
  }];

  NSMutableString *out = [NSMutableString string];
  NSMutableArray<NSNumber *> *line = [NSMutableArray array];
  __block CGFloat lineY = 0, lineH = 0;
  void (^flush)(void) = ^{
    if (line.count == 0) return;
    [line sortUsingComparator:^NSComparisonResult(NSNumber *a, NSNumber *b) {
      CGFloat xa = glyphs[a.unsignedIntegerValue].x, xb = glyphs[b.unsignedIntegerValue].x;
      return xa < xb ? NSOrderedAscending : (xa > xb ? NSOrderedDescending : NSOrderedSame);
    }];
    CGFloat lastRight = -1;
    for (NSNumber *k in line) {
      Glyph g = glyphs[k.unsignedIntegerValue];
      if (lastRight >= 0) {
        CGFloat gap = g.x - lastRight;
        // A word gap gets a space; a column gap gets a few, so cells stay apart.
        if (gap > g.h * 1.5) [out appendString:@"   "];
        else if (gap > g.h * 0.18) [out appendString:@" "];
      }
      [out appendString:[s substringWithRange:[s rangeOfComposedCharacterSequenceAtIndex:g.index]]];
      lastRight = g.x + g.w;
    }
    [out appendString:@"\n"];
    [line removeAllObjects];
  };
  for (NSNumber *k in order) {
    Glyph g = glyphs[k.unsignedIntegerValue];
    if (line.count > 0 && fabs(g.midY - lineY) > MIN(g.h, lineH) * 0.5) flush();
    if (line.count == 0) {
      lineY = g.midY;
      lineH = g.h;
    }
    [line addObject:k];
  }
  flush();
  free(glyphs);
  return out;
}

- (void)readPath:(NSString *)path
        password:(NSString *)password
          layout:(BOOL)layout
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSURL *url = [NSURL fileURLWithPath:path];
    if (![path.pathExtension.lowercaseString isEqualToString:@"pdf"]) {
      NSError *error = nil;
      NSString *text = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:&error];
      if (text == nil) {
        text = [NSString stringWithContentsOfURL:url encoding:NSWindowsCP1252StringEncoding error:&error];
      }
      if (text == nil) {
        reject(@"READ", @"Couldn't read this file.", error);
      } else {
        resolve(text);
      }
      return;
    }

    PDFDocument *doc = [[PDFDocument alloc] initWithURL:url];
    if (doc == nil) {
      reject(@"READ", @"Couldn't open this PDF.", nil);
      return;
    }
    if (doc.isLocked) {
      if (password.length == 0 || ![doc unlockWithPassword:password]) {
        reject(@"PASSWORD", password.length ? @"Wrong password." : @"This PDF needs a password.", nil);
        return;
      }
    }
    NSMutableString *text = [NSMutableString string];
    for (NSInteger i = 0; i < doc.pageCount; i++) {
      PDFPage *pdfPage = [doc pageAtIndex:i];
      NSString *page = layout ? LayoutText(pdfPage) : pdfPage.string;
      if (page.length) {
        [text appendString:page];
        [text appendString:@"\n"];
      }
    }
    if (text.length == 0) {
      reject(@"EMPTY", @"This PDF has no readable text (it may be a scanned image).", nil);
      return;
    }
    resolve(text);
  });
}

@end
