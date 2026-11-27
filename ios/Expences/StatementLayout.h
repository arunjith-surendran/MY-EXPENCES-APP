// Shared by StatementImporter.m and a macOS test harness, so it only uses PDFKit/Foundation.
#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>

/** True if the text contains Arabic (or Hebrew) letters, i.e. reads right to left. */
static inline BOOL StatementIsRTL(NSString *s)
{
  for (NSUInteger i = 0; i < s.length; i++) {
    unichar c = [s characterAtIndex:i];
    if ((c >= 0x0590 && c <= 0x08FF) || (c >= 0xFB1D && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF)) {
      return YES;
    }
  }
  return NO;
}

/**
 * The page's text with each table row on one line, whatever order the PDF stores it in.
 *
 * PDFKit's own `string` often lists a table column by column (all dates, then all
 * amounts). Here PDFKit's text runs (which keep Arabic in reading order) are grouped by
 * their height on the page, and each row's cells are joined left to right, or right to
 * left when the row is Arabic, so the date column comes first either way.
 */
static inline NSString *StatementLayoutText(PDFPage *page)
{
  NSString *all = page.string;
  if (all.length == 0) return @"";
  PDFSelection *selection = [page selectionForRange:NSMakeRange(0, all.length)];
  NSArray<PDFSelection *> *runs = selection.selectionsByLine;
  if (runs.count == 0) return all;

  typedef struct {
    CGFloat minX, maxX, midY, height;
  } Box;
  NSMutableArray<NSString *> *texts = [NSMutableArray array];
  NSMutableData *boxes = [NSMutableData data];
  NSCharacterSet *space = [NSCharacterSet whitespaceAndNewlineCharacterSet];
  for (PDFSelection *run in runs) {
    NSString *text = [run.string stringByTrimmingCharactersInSet:space];
    if (text.length == 0) continue;
    CGRect b = [run boundsForPage:page];
    if (CGRectIsEmpty(b) || CGRectIsNull(b)) continue;
    Box box = {CGRectGetMinX(b), CGRectGetMaxX(b), CGRectGetMidY(b), MAX(CGRectGetHeight(b), 1)};
    [boxes appendBytes:&box length:sizeof(Box)];
    [texts addObject:text];
  }
  NSUInteger n = texts.count;
  if (n == 0) return all;
  const Box *box = boxes.bytes;

  // Top of the page first (PDF y grows upwards).
  NSMutableArray<NSNumber *> *order = [NSMutableArray arrayWithCapacity:n];
  for (NSUInteger i = 0; i < n; i++) [order addObject:@(i)];
  [order sortUsingComparator:^NSComparisonResult(NSNumber *a, NSNumber *b) {
    CGFloat ya = box[a.unsignedIntegerValue].midY, yb = box[b.unsignedIntegerValue].midY;
    return ya > yb ? NSOrderedAscending : (ya < yb ? NSOrderedDescending : NSOrderedSame);
  }];

  // Group runs into rows: centres closer than half the shorter run's height.
  NSMutableArray<NSMutableArray<NSNumber *> *> *rows = [NSMutableArray array];
  CGFloat rowY = 0, rowH = 0;
  for (NSNumber *k in order) {
    Box b = box[k.unsignedIntegerValue];
    if (rows.count == 0 || fabs(b.midY - rowY) > MIN(b.height, rowH) * 0.5) {
      [rows addObject:[NSMutableArray array]];
      rowY = b.midY;
      rowH = b.height;
    }
    [rows.lastObject addObject:k];
  }

  // Which way the page reads. Statements mix English shop names into Arabic tables, so
  // decide once per page: if dates sit at the right end of their rows, it's right to left.
  NSRegularExpression *date = [NSRegularExpression
      regularExpressionWithPattern:@"\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\b\\d{1,2}[ -][A-Za-z]{3,9}[ -]\\d{2,4}\\b"
                           options:0
                             error:nil];
  BOOL (^isDate)(NSString *) = ^BOOL(NSString *t) {
    return [date firstMatchInString:t options:0 range:NSMakeRange(0, t.length)] != nil;
  };
  NSInteger rightVotes = 0, leftVotes = 0, arabicRuns = 0;
  for (NSArray<NSNumber *> *r in rows) {
    if (r.count < 2) continue;
    NSUInteger left = r[0].unsignedIntegerValue, right = left;
    for (NSNumber *k in r) {
      NSUInteger i = k.unsignedIntegerValue;
      if (box[i].minX < box[left].minX) left = i;
      if (box[i].minX > box[right].minX) right = i;
    }
    if (isDate(texts[right]) && !isDate(texts[left])) rightVotes++;
    if (isDate(texts[left]) && !isDate(texts[right])) leftVotes++;
  }
  for (NSString *t in texts) if (StatementIsRTL(t)) arabicRuns++;
  BOOL rtl = rightVotes != leftVotes ? rightVotes > leftVotes : arabicRuns * 2 > (NSInteger)n;

  NSMutableString *out = [NSMutableString string];
  for (NSMutableArray<NSNumber *> *r in rows) {
    [r sortUsingComparator:^NSComparisonResult(NSNumber *a, NSNumber *b) {
      CGFloat xa = box[a.unsignedIntegerValue].minX, xb = box[b.unsignedIntegerValue].minX;
      NSComparisonResult c = xa < xb ? NSOrderedAscending : (xa > xb ? NSOrderedDescending : NSOrderedSame);
      return rtl ? -c : c;
    }];
    NSMutableArray<NSString *> *cells = [NSMutableArray arrayWithCapacity:r.count];
    for (NSNumber *k in r) [cells addObject:texts[k.unsignedIntegerValue]];
    [out appendString:[cells componentsJoinedByString:@"   "]];
    [out appendString:@"\n"];
  }
  return out;
}
