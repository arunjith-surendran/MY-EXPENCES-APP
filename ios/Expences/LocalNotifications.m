#import <React/RCTBridgeModule.h>
#import <UserNotifications/UserNotifications.h>

/**
 * Local notifications for the app's JavaScript (messages from the Expences team).
 * No push server is involved, so this works with any signing team.
 *
 *   requestPermission()        -> true if notifications are allowed
 *   show(id, title, body)      -> shows it now; the same id replaces instead of duplicating
 *   schedule(id, title, body, atMs) -> shows it at that time (unix ms); same id replaces
 *   cancel(id)                 -> removes a scheduled one
 */
@interface LocalNotifications : NSObject <RCTBridgeModule>
@end

@implementation LocalNotifications

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(requestPermission
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  UNAuthorizationOptions options =
      UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
  [[UNUserNotificationCenter currentNotificationCenter]
      requestAuthorizationWithOptions:options
                    completionHandler:^(BOOL granted, NSError *_Nullable error) {
                      resolve(@(granted));
                    }];
}

RCT_EXPORT_METHOD(show
                  : (NSString *)identifier title
                  : (NSString *)title body
                  : (NSString *)body resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = title;
  content.body = body;
  content.sound = [UNNotificationSound defaultSound];
  content.threadIdentifier = @"team";
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier
                                                                        content:content
                                                                        trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter]
      addNotificationRequest:request
       withCompletionHandler:^(NSError *_Nullable error) {
         if (error) {
           reject(@"NOTIFY", error.localizedDescription, error);
         } else {
           resolve(nil);
         }
       }];
}

RCT_EXPORT_METHOD(schedule
                  : (NSString *)identifier title
                  : (NSString *)title body
                  : (NSString *)body at
                  : (double)atMs resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  NSTimeInterval seconds = atMs / 1000.0 - [[NSDate date] timeIntervalSince1970];
  if (seconds < 1) {
    resolve(@NO); // already past
    return;
  }
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = title;
  content.body = body;
  content.sound = [UNNotificationSound defaultSound];
  content.threadIdentifier = @"reminders";
  UNTimeIntervalNotificationTrigger *trigger =
      [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:seconds repeats:NO];
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier
                                                                        content:content
                                                                        trigger:trigger];
  [[UNUserNotificationCenter currentNotificationCenter]
      addNotificationRequest:request
       withCompletionHandler:^(NSError *_Nullable error) {
         if (error) {
           reject(@"NOTIFY", error.localizedDescription, error);
         } else {
           resolve(@YES);
         }
       }];
}

RCT_EXPORT_METHOD(cancel
                  : (NSString *)identifier resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  [[UNUserNotificationCenter currentNotificationCenter]
      removePendingNotificationRequestsWithIdentifiers:@[ identifier ]];
  resolve(nil);
}

@end

/** The installed build's version, read from the bundle (MARKETING_VERSION / CURRENT_PROJECT_VERSION). */
@interface AppInfo : NSObject <RCTBridgeModule>
@end

@implementation AppInfo

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSDictionary *)constantsToExport
{
  NSDictionary *info = [[NSBundle mainBundle] infoDictionary];
  return @{
    @"version" : info[@"CFBundleShortVersionString"] ?: @"",
    @"build" : info[@"CFBundleVersion"] ?: @"",
  };
}

@end
