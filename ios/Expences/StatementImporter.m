#import <PDFKit/PDFKit.h>
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
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.pickResolve != nil) {
      reject(@"BUSY", @"A file picker is already open.", nil);
      return;
    }
    self.pickResolve = resolve;
    self.pickReject = reject;

    NSArray<UTType *> *types = @[ UTTypePDF, UTTypeCommaSeparatedText, UTTypePlainText ];
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
      NSString *page = [doc pageAtIndex:i].string;
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
