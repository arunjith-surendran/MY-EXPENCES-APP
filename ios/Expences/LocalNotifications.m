#import <React/RCTBridgeModule.h>
#import <UserNotifications/UserNotifications.h>

/**
 * Local notifications for the app's JavaScript (messages from the Expences team).
 * No push server is involved, so this works with any signing team.
 *
 *   requestPermission()        -> true if notifications are allowed
 *   show(id, title, body)      -> shows it now; the same id replaces instead of duplicating
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

@end
