// Shared by StatementImporter.m and a macOS test harness (PDFKit + Vision only).
#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#import <Vision/Vision.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

/**
 * Some bank PDFs (e.g. Emirates NBD e-statements) draw their English text as shapes, so
 * there is no text to read: only the Arabic header is real text. For those, each page is
 * rendered and read with on-device text recognition (Vision). Nothing leaves the phone.
 */

typedef struct {
  CGFloat minX, midY, height;
} StatementOcrBox;

static NSRegularExpression *StatementOcrDateRegex(void)
{
  static NSRegularExpression *re;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    re = [NSRegularExpression
        regularExpressionWithPattern:@"^\\d{1,2}[/.-]?\\d{1,2}[/.-]\\d{2,4}|^\\d{1,2}[ -][A-Za-z]{3,9}[ -]\\d{2,4}"
                             options:0
                               error:nil];
  });
  return re;
}

// The first separator is optional: OCR sometimes drops it ("1411/2026").

/**
 * Rebuilds table rows from recognised text. A table row's cells don't share one line: the
 * date sits in the middle while a two-line description sits above and below it. So rows
 * are anchored on the dates in the left-hand column, every piece of text near a date
 * joins its row (left to right, top to bottom within a column), and everything else
 * (headers, footers, opening balance) stays a line of its own, in page order.
 */
static inline NSString *StatementOcrRows(NSArray<NSString *> *texts, const StatementOcrBox *box)
{
  NSUInteger n = texts.count;
  if (n == 0) return @"";
  NSRegularExpression *date = StatementOcrDateRegex();

  // Date anchors: text starting with a date, in the date column. Descriptions can start
  // with a date too ("30-10-2026 6.50,AED" on a wrapped line), so only the left-most
  // column of dates counts.
  NSMutableArray<NSNumber *> *dated = [NSMutableArray array];
  CGFloat dateColumn = CGFLOAT_MAX;
  for (NSUInteger i = 0; i < n; i++) {
    NSString *t = texts[i];
    if ([date firstMatchInString:t options:0 range:NSMakeRange(0, t.length)]) {
      [dated addObject:@(i)];
      dateColumn = MIN(dateColumn, box[i].minX);
    }
  }
  NSMutableArray<NSNumber *> *anchors = [NSMutableArray array];
  for (NSNumber *k in dated) {
    if (box[k.unsignedIntegerValue].minX < dateColumn + 0.03) [anchors addObject:k];
  }
  [anchors sortUsingComparator:^NSComparisonResult(NSNumber *a, NSNumber *b) {
    CGFloat ya = box[a.unsignedIntegerValue].midY, yb = box[b.unsignedIntegerValue].midY;
    return ya > yb ? NSOrderedAscending : (ya < yb ? NSOrderedDescending : NSOrderedSame);
  }];

  // How far from its date a row's text can be: under half the gap between rows.
  CGFloat reach = 0;
  if (anchors.count >= 2) {
    NSMutableArray<NSNumber *> *gaps = [NSMutableArray array];
    for (NSUInteger i = 1; i < anchors.count; i++) {
      [gaps addObject:@(box[anchors[i - 1].unsignedIntegerValue].midY - box[anchors[i].unsignedIntegerValue].midY)];
    }
    [gaps sortUsingSelector:@selector(compare:)];
    reach = gaps[gaps.count / 2].doubleValue * 0.5;
  } else if (anchors.count == 1) {
    reach = box[anchors[0].unsignedIntegerValue].height * 2.5;
  }

  NSMutableDictionary<NSNumber *, NSMutableArray<NSNumber *> *> *rows = [NSMutableDictionary dictionary];
  NSMutableArray<NSNumber *> *loose = [NSMutableArray array];
  for (NSUInteger i = 0; i < n; i++) {
    NSNumber *best = nil;
    CGFloat bestDy = CGFLOAT_MAX;
    for (NSNumber *a in anchors) {
      CGFloat dy = fabs(box[i].midY - box[a.unsignedIntegerValue].midY);
      if (dy < bestDy) {
        bestDy = dy;
        best = a;
      }
    }
    if (best && bestDy < reach) {
      if (!rows[best]) rows[best] = [NSMutableArray array];
      [rows[best] addObject:@(i)];
    } else {
      [loose addObject:@(i)];
    }
  }

  // Lines to print: each row (at its date's height) and each loose piece, top to bottom.
  typedef struct {
    CGFloat y;
    NSUInteger key;
    BOOL isRow;
  } Line;
  NSMutableData *lines = [NSMutableData data];
  for (NSNumber *a in anchors) {
    if (!rows[a]) continue;
    Line l = {box[a.unsignedIntegerValue].midY, a.unsignedIntegerValue, YES};
    [lines appendBytes:&l length:sizeof(Line)];
  }
  for (NSNumber *k in loose) {
    Line l = {box[k.unsignedIntegerValue].midY, k.unsignedIntegerValue, NO};
    [lines appendBytes:&l length:sizeof(Line)];
  }
  NSUInteger count = lines.length / sizeof(Line);
  Line *all = lines.mutableBytes;
  qsort_b(all, count, sizeof(Line), ^int(const void *a, const void *b) {
    CGFloat ya = ((const Line *)a)->y, yb = ((const Line *)b)->y;
    return ya > yb ? -1 : (ya < yb ? 1 : 0);
  });

  NSMutableString *out = [NSMutableString string];
  NSMutableArray<NSString *> *pending = [NSMutableArray array];
  CGFloat pendingY = 0, pendingH = 0;
  void (^flushLoose)(void) = ^{
    if (pending.count) {
      [out appendString:[pending componentsJoinedByString:@"   "]];
      [out appendString:@"\n"];
      [pending removeAllObjects];
    }
  };
  for (NSUInteger i = 0; i < count; i++) {
    Line l = all[i];
    if (l.isRow) {
      flushLoose();
      NSMutableArray<NSNumber *> *cells = rows[@(l.key)];
      // Left to right by column; within a column (a wrapped description) top to bottom.
      [cells sortUsingComparator:^NSComparisonResult(NSNumber *a, NSNumber *b) {
        StatementOcrBox ba = box[a.unsignedIntegerValue], bb = box[b.unsignedIntegerValue];
        if (fabs(ba.minX - bb.minX) > 0.02) return ba.minX < bb.minX ? NSOrderedAscending : NSOrderedDescending;
        return ba.midY > bb.midY ? NSOrderedAscending : NSOrderedDescending;
      }];
      NSMutableArray<NSString *> *parts = [NSMutableArray array];
      for (NSNumber *k in cells) [parts addObject:texts[k.unsignedIntegerValue]];
      [out appendString:[parts componentsJoinedByString:@"   "]];
      [out appendString:@"\n"];
    } else {
      StatementOcrBox b = box[l.key];
      if (pending.count && fabs(b.midY - pendingY) > MIN(b.height, pendingH) * 0.5) flushLoose();
      if (pending.count == 0) {
        pendingY = b.midY;
        pendingH = b.height;
      }
      [pending addObject:texts[l.key]];
    }
  }
  flushLoose();
  return out;
}

/** Renders a page and reads its text with Vision. Runs synchronously; call off the main thread. */
static inline NSString *StatementOcrPage(PDFPage *page)
{
  CGRect bounds = [page boundsForBox:kPDFDisplayBoxMediaBox];
  // 4x reads small table digits noticeably better than 2x or 3x.
  CGFloat scale = 4.0;
  CGSize size = CGSizeMake(bounds.size.width * scale, bounds.size.height * scale);
#if TARGET_OS_IPHONE
  CGImageRef image = [page thumbnailOfSize:size forBox:kPDFDisplayBoxMediaBox].CGImage;
#else
  CGImageRef image = [[page thumbnailOfSize:size forBox:kPDFDisplayBoxMediaBox] CGImageForProposedRect:NULL
                                                                                                 context:nil
                                                                                                   hints:nil];
#endif
  if (!image) return @"";

  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.recognitionLanguages = @[ @"en-US" ];
  // Account numbers and amounts aren't words; correction would "fix" them.
  request.usesLanguageCorrection = NO;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  if (![handler performRequests:@[ request ] error:nil]) return @"";

  NSMutableArray<NSString *> *texts = [NSMutableArray array];
  NSMutableData *boxes = [NSMutableData data];
  for (VNRecognizedTextObservation *o in request.results) {
    NSString *t = [o topCandidates:1].firstObject.string;
    if (t.length == 0) continue;
    CGRect r = o.boundingBox; // 0–1, origin bottom-left
    StatementOcrBox b = {CGRectGetMinX(r), CGRectGetMidY(r), MAX(CGRectGetHeight(r), 0.001)};
    [boxes appendBytes:&b length:sizeof(b)];
    [texts addObject:t];
  }
  return StatementOcrRows(texts, boxes.bytes);
}
