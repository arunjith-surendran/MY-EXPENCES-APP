import AppIntents
import Foundation
import SQLite3
import UserNotifications

/// A single Shortcuts action ("Save Apple Pay Payment") for the Wallet automation.
/// It writes the payment straight into the app's SQLite database in the background,
/// so it works even when the app is closed and never needs to bring the app to the front.
/// Parsing and categories mirror src/lib/parse.ts.
@available(iOS 18.0, *)
struct SavePaymentIntent: AppIntent {
  static var title: LocalizedStringResource = "Save Apple Pay Payment"
  static var description = IntentDescription(
    "Saves a Wallet payment to Expences. Use it in a Wallet automation and set each field to Shortcut Input."
  )
  static var openAppWhenRun = false

  @Parameter(title: "Amount")
  var amount: String

  @Parameter(title: "Merchant")
  var merchant: String?

  @Parameter(title: "Card")
  var card: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Save \(\.$amount) at \(\.$merchant) with \(\.$card)")
  }

  func perform() async throws -> some IntentResult {
    do {
      let savedCategory = try saveRun()
      let status = savedCategory == nil ? "duplicate" : "saved"
      RunLog.record(status: status, amount: amount, merchant: merchant, card: card, message: nil)
      if let savedCategory {
        await PaymentNotice.post(amount: amount, merchant: merchant, category: savedCategory)
        await BudgetNotice.check(category: savedCategory)
      }
    } catch {
      let message = (error as? PaymentError)?.text ?? String(describing: error)
      RunLog.record(status: "failed", amount: amount, merchant: merchant, card: card, message: message)
      throw error
    }
    return .result()
  }

  /// Returns the category it was saved under, or nil for a duplicate; throws with a readable message on failure.
  private func saveRun() throws -> String? {
    guard let value = PaymentParser.amount(amount) else {
      throw PaymentError.message("Couldn't read the amount \"\(amount)\".")
    }
    let name = (merchant ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let merchantName = name.isEmpty ? "Apple Pay" : name
    let cardName = (card ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    // If only Amount was filled (often with the whole Shortcut Input), keep the raw text.
    let note: String? = name.isEmpty ? amount : nil

    return try ExpenseStore.save(
      amount: value,
      currency: PaymentParser.currency(amount),
      merchant: merchantName,
      card: cardName.isEmpty ? nil : cardName,
      category: PaymentParser.category(merchantName),
      note: note
    )
  }
}

@available(iOS 18.0, *)
enum PaymentError: Error, CustomLocalizedStringResourceConvertible {
  case message(String)
  var text: String {
    switch self {
    case .message(let text): return text
    }
  }
  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .message(let text): return "\(text)"
    }
  }
}

enum PaymentParser {
  /// "AED 25.00", "25.00 AED", "د.إ.‏ 1,234.50", Arabic-Indic digits → 25.0 / 1234.5
  static func amount(_ raw: String) -> Double? {
    var s = ""
    for ch in raw {
      if let d = "٠١٢٣٤٥٦٧٨٩".firstIndex(of: ch) {
        s += String("٠١٢٣٤٥٦٧٨٩".distance(from: "٠١٢٣٤٥٦٧٨٩".startIndex, to: d))
      } else if ch == "٫" {
        s += "."
      } else if ch == "٬" {
        s += ","
      } else {
        s.append(ch)
      }
    }
    guard let range = s.range(of: #"\d[\d,]*(\.\d+)?"#, options: .regularExpression) else {
      return nil
    }
    guard let n = Double(s[range].replacingOccurrences(of: ",", with: "")), n > 0 else {
      return nil
    }
    return (n * 100).rounded() / 100
  }

  static func currency(_ raw: String) -> String {
    if raw.contains("د.إ") { return "AED" }
    if raw.contains("$") { return "USD" }
    if raw.contains("€") { return "EUR" }
    if raw.contains("£") { return "GBP" }
    if raw.contains("₹") { return "INR" }
    if let r = raw.range(of: #"\b[A-Z]{3}\b"#, options: .regularExpression) {
      return String(raw[r])
    }
    return "AED"
  }

  private static let rules: [(String, String)] = [
    ("carrefour|lulu|spinneys|waitrose|choithrams|union coop|viva|nesto|grandiose|al maya|kibsons|instashop", "Groceries"),
    ("talabat|deliveroo|noon food|careem food|starbucks|tim hortons|costa|mcdonald|kfc|burger|pizza|shawarma|cafe|coffee|restaurant|cafeteria", "Food & Dining"),
    ("enoc|adnoc|emarat|eppco", "Fuel"),
    ("careem|uber|rta|nol|salik|darb|metro|taxi|parkin|valtrans", "Transport"),
    (#"dewa|sewa|addc|fewa|etisalat|e&|\bdu\b|empower|tabreed"#, "Bills & Utilities"),
    ("noon|amazon|namshi|ikea|centrepoint|max|home centre|sharaf dg|jumbo|virgin|mall", "Shopping"),
    ("pharmacy|aster|life pharmacy|boots|clinic|hospital|medcare|nmc", "Health"),
    (#"vox|reel cinema|novo|netflix|spotify|apple\.com|playstation|steam"#, "Entertainment"),
  ]

  static func category(_ merchant: String) -> String {
    for (pattern, cat) in rules
    where merchant.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
      return cat
    }
    return "Other"
  }
}

/// Minimal writer for the app's database (the same file op-sqlite opens: Library/expenses.db).
@available(iOS 18.0, *)
enum ExpenseStore {
  private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  /// Same normalization as merchantKey() in src/lib/db.ts.
  static func merchantKey(_ merchant: String) -> String {
    merchant.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  /// From the merchant_categories table (src/lib/db.ts); nil if it's missing or has no row.
  private static func learnedCategory(_ db: OpaquePointer?, _ merchant: String) -> String? {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(
      db, "SELECT category FROM merchant_categories WHERE merchant = ?", -1, &stmt, nil)
      == SQLITE_OK
    else { return nil }
    defer { sqlite3_finalize(stmt) }
    sqlite3_bind_text(stmt, 1, merchantKey(merchant), -1, transient)
    guard sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) else {
      return nil
    }
    return String(cString: text)
  }

  static func save(
    amount: Double, currency: String, merchant: String, card: String?, category: String,
    note: String?
  ) throws -> String? {
    let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    let path = dir.appendingPathComponent("expenses.db").path
    var db: OpaquePointer?
    guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK
    else {
      sqlite3_close(db)
      throw PaymentError.message("Couldn't open the Expences database.")
    }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 3000)

    // Same schema the app creates; harmless if it already exists.
    try exec(db, """
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'AED', merchant TEXT NOT NULL, card TEXT,
        category TEXT NOT NULL, source TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      """)

    let now = Int64(Date().timeIntervalSince1970 * 1000)

    // Auto-logging is a Pro feature. The app stores when trial/Pro access ends (src/lib/subscription.ts);
    // no value yet (app not opened since updating) means allowed.
    var access: OpaquePointer?
    sqlite3_prepare_v2(db, "SELECT value FROM meta WHERE key = 'pro_access_until'", -1, &access, nil)
    let accessUntil: Int64? =
      sqlite3_step(access) == SQLITE_ROW ? sqlite3_column_int64(access, 0) : nil
    sqlite3_finalize(access)
    if let accessUntil, now > accessUntil {
      throw PaymentError.message(
        "Auto-logging is part of Expences Pro. Open Expences to subscribe, or add this payment by hand.")
    }

    // Skip if the same payment was already saved in the last minute (automation fired twice).
    var dup: OpaquePointer?
    sqlite3_prepare_v2(
      db, "SELECT COUNT(*) FROM expenses WHERE amount = ? AND merchant = ? AND created_at > ?", -1,
      &dup, nil)
    sqlite3_bind_double(dup, 1, amount)
    sqlite3_bind_text(dup, 2, merchant, -1, transient)
    sqlite3_bind_int64(dup, 3, now - 60_000)
    let isDuplicate = sqlite3_step(dup) == SQLITE_ROW && sqlite3_column_int(dup, 0) > 0
    sqlite3_finalize(dup)
    if isDuplicate { return nil }

    // The category the user last picked for this merchant in the app wins over the built-in guess.
    let savedCategory = learnedCategory(db, merchant) ?? category

    var stmt: OpaquePointer?
    let sql = """
      INSERT INTO expenses (amount, currency, merchant, card, category, source, note, created_at)
      VALUES (?, ?, ?, ?, ?, 'apple_pay', ?, ?)
      """
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
      throw PaymentError.message("Couldn't prepare the save.")
    }
    defer { sqlite3_finalize(stmt) }
    sqlite3_bind_double(stmt, 1, amount)
    sqlite3_bind_text(stmt, 2, currency, -1, transient)
    sqlite3_bind_text(stmt, 3, merchant, -1, transient)
    if let card { sqlite3_bind_text(stmt, 4, card, -1, transient) } else { sqlite3_bind_null(stmt, 4) }
    sqlite3_bind_text(stmt, 5, savedCategory, -1, transient)
    if let note { sqlite3_bind_text(stmt, 6, note, -1, transient) } else { sqlite3_bind_null(stmt, 6) }
    sqlite3_bind_int64(stmt, 7, now)
    guard sqlite3_step(stmt) == SQLITE_DONE else {
      throw PaymentError.message("Couldn't save the payment: \(String(cString: sqlite3_errmsg(db)))")
    }

    // First successful automation run → the app shows "auto-logging is on".
    try exec(db, "INSERT OR IGNORE INTO meta (key, value) VALUES ('auto_log_since', '\(now)')")
    return savedCategory
  }

  private static func exec(_ db: OpaquePointer?, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
      throw PaymentError.message("Database error: \(String(cString: sqlite3_errmsg(db)))")
    }
  }
}

/// A record of every automation run (kept to the latest 50), so failures can be diagnosed later.
/// Written to the `autolog` table; if the database can't be opened, to Library/autolog.txt instead.
enum RunLog {
  static func record(status: String, amount: String, merchant: String?, card: String?, message: String?) {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    var db: OpaquePointer?
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    if sqlite3_open_v2(dir.appendingPathComponent("expenses.db").path, &db,
                       SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK {
      defer { sqlite3_close(db) }
      sqlite3_busy_timeout(db, 3000)
      sqlite3_exec(db, """
        CREATE TABLE IF NOT EXISTS autolog (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, status TEXT NOT NULL,
          amount TEXT, merchant TEXT, card TEXT, message TEXT)
        """, nil, nil, nil)
      var stmt: OpaquePointer?
      if sqlite3_prepare_v2(db,
          "INSERT INTO autolog (at, status, amount, merchant, card, message) VALUES (?, ?, ?, ?, ?, ?)",
          -1, &stmt, nil) == SQLITE_OK {
        sqlite3_bind_int64(stmt, 1, now)
        for (i, v) in [status, amount, merchant, card, message].enumerated() {
          if let v { sqlite3_bind_text(stmt, Int32(i + 2), v, -1, transient) }
          else { sqlite3_bind_null(stmt, Int32(i + 2)) }
        }
        let ok = sqlite3_step(stmt) == SQLITE_DONE
        sqlite3_finalize(stmt)
        if ok {
          sqlite3_exec(db, "DELETE FROM autolog WHERE id NOT IN (SELECT id FROM autolog ORDER BY id DESC LIMIT 50)", nil, nil, nil)
          return
        }
      }
    }
    // Fallback: plain text file.
    let line = "\(Date()) | \(status) | amount=\(amount) | merchant=\(merchant ?? "-") | card=\(card ?? "-") | \(message ?? "")\n"
    let file = dir.appendingPathComponent("autolog.txt")
    if let h = try? FileHandle(forWritingTo: file) {
      h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close()
    } else {
      try? line.write(to: file, atomically: true, encoding: .utf8)
    }
  }
}

@available(iOS 18.0, *)
struct ExpencesShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SavePaymentIntent(),
      phrases: [
        "Save a payment in \(.applicationName)",
        "Add an expense in \(.applicationName)",
        "Log a payment in \(.applicationName)",
        "Add to \(.applicationName)",
      ],
      shortTitle: "Save Payment",
      systemImageName: "creditcard"
    )
  }
}

/// "Saved AED 25.00 at Carrefour" as a notification after each auto-logged payment,
/// with this month's total. Off when the user turned it off in Account (meta notify_payments = 0)
/// or hasn't allowed notifications.
@available(iOS 18.0, *)
enum PaymentNotice {
  static func post(amount raw: String, merchant: String?, category: String) async {
    guard let value = PaymentParser.amount(raw) else { return }
    let currency = PaymentParser.currency(raw)
    let name = (merchant ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let (enabled, monthTotal) = settings()
    guard enabled else { return }

    let center = UNUserNotificationCenter.current()
    guard await center.notificationSettings().authorizationStatus == .authorized else { return }

    let content = UNMutableNotificationContent()
    content.title = "Saved \(money(value, currency))\(name.isEmpty ? "" : " at \(name)")"
    content.body = "\(category) · This month: \(money(monthTotal, "AED"))"
    content.sound = .default
    content.threadIdentifier = "payments"
    try? await center.add(
      UNNotificationRequest(identifier: "payment-\(UUID().uuidString)", content: content, trigger: nil))
  }

  private static func money(_ n: Double, _ currency: String) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.minimumFractionDigits = 2
    f.maximumFractionDigits = 2
    f.locale = Locale(identifier: "en_AE")
    return "\(currency) \(f.string(from: NSNumber(value: n)) ?? String(format: "%.2f", n))"
  }

  /// (notifications on, AED spent this calendar month) from the app's database.
  private static func settings() -> (Bool, Double) {
    let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    var db: OpaquePointer?
    guard sqlite3_open_v2(dir.appendingPathComponent("expenses.db").path, &db,
                          SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
      sqlite3_close(db)
      return (true, 0)
    }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 3000)

    var enabled = true
    var flag: OpaquePointer?
    if sqlite3_prepare_v2(db, "SELECT value FROM meta WHERE key = 'notify_payments'", -1, &flag, nil) == SQLITE_OK,
       sqlite3_step(flag) == SQLITE_ROW, let v = sqlite3_column_text(flag, 0) {
      enabled = String(cString: v) != "0"
    }
    sqlite3_finalize(flag)

    let cal = Calendar.current
    let start = cal.date(from: cal.dateComponents([.year, .month], from: Date())) ?? Date()
    var total = 0.0
    var sum: OpaquePointer?
    // Foreign-currency payments count with their AED value (aed_amount, filled in by the app);
    // a database from before that column existed falls back to AED only.
    let converted =
      "SELECT COALESCE(SUM(CASE WHEN currency = 'AED' THEN amount ELSE COALESCE(aed_amount, 0) END), 0) FROM expenses WHERE created_at >= ?"
    let aedOnly = "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE currency = 'AED' AND created_at >= ?"
    if sqlite3_prepare_v2(db, converted, -1, &sum, nil) == SQLITE_OK
      || sqlite3_prepare_v2(db, aedOnly, -1, &sum, nil) == SQLITE_OK
    {
      sqlite3_bind_int64(sum, 1, Int64(start.timeIntervalSince1970 * 1000))
      if sqlite3_step(sum) == SQLITE_ROW { total = sqlite3_column_double(sum, 0) }
    }
    sqlite3_finalize(sum)
    return (enabled, total)
  }
}

/// Budget alerts right after an Apple Pay tap: the first time this month the category's
/// budget passes 80% and 100%. Same rules and meta keys as src/lib/budgets.ts, so the app
/// doesn't send the same alert again when it opens.
@available(iOS 18.0, *)
enum BudgetNotice {
  private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  static func check(category: String) async {
    let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    var db: OpaquePointer?
    guard sqlite3_open_v2(dir.appendingPathComponent("expenses.db").path, &db,
                          SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
      sqlite3_close(db)
      return
    }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 3000)

    // The budget for this category (no table yet, or no budget: nothing to do).
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT amount FROM budgets WHERE category = ?", -1, &stmt, nil) == SQLITE_OK
    else { return }
    sqlite3_bind_text(stmt, 1, category, -1, transient)
    let budget = sqlite3_step(stmt) == SQLITE_ROW ? sqlite3_column_double(stmt, 0) : 0
    sqlite3_finalize(stmt)
    guard budget > 0 else { return }

    let cal = Calendar.current
    let now = Date()
    let start = cal.date(from: cal.dateComponents([.year, .month], from: now)) ?? now
    let end = cal.date(byAdding: .month, value: 1, to: start) ?? now
    var spent = 0.0
    let sql = """
      SELECT COALESCE(SUM(CASE WHEN currency = 'AED' THEN amount ELSE COALESCE(aed_amount, 0) END), 0)
      FROM expenses WHERE category = ? AND created_at >= ? AND created_at < ?
      """
    if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
      sqlite3_bind_text(stmt, 1, category, -1, transient)
      sqlite3_bind_int64(stmt, 2, Int64(start.timeIntervalSince1970 * 1000))
      sqlite3_bind_int64(stmt, 3, Int64(end.timeIntervalSince1970 * 1000))
      if sqlite3_step(stmt) == SQLITE_ROW { spent = sqlite3_column_double(stmt, 0) }
    }
    sqlite3_finalize(stmt)

    let reached: Double = spent >= budget ? 1 : (spent >= budget * 0.8 ? 0.8 : 0)
    guard reached > 0 else { return }

    let month = String(format: "%04d-%02d", cal.component(.year, from: now), cal.component(.month, from: now))
    let key = "budget_alert:\(month):\(category)"
    var sent = 0.0
    if sqlite3_prepare_v2(db, "SELECT value FROM meta WHERE key = ?", -1, &stmt, nil) == SQLITE_OK {
      sqlite3_bind_text(stmt, 1, key, -1, transient)
      if sqlite3_step(stmt) == SQLITE_ROW, let v = sqlite3_column_text(stmt, 0) {
        sent = Double(String(cString: v)) ?? 0
      }
    }
    sqlite3_finalize(stmt)
    guard reached > sent else { return }

    if sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", -1, &stmt, nil) == SQLITE_OK {
      sqlite3_bind_text(stmt, 1, key, -1, transient)
      sqlite3_bind_text(stmt, 2, reached >= 1 ? "1" : "0.8", -1, transient)
      sqlite3_step(stmt)
    }
    sqlite3_finalize(stmt)

    let center = UNUserNotificationCenter.current()
    guard await center.notificationSettings().authorizationStatus == .authorized else { return }
    let content = UNMutableNotificationContent()
    content.title = reached >= 1 ? "\(category) budget used up" : "\(category): 80% of budget spent"
    let over = spent - budget
    content.body = reached >= 1
      ? "\(money(spent)) of \(money(budget)) this month\(over > 0 ? " (\(money(over)) over)" : "")."
      : "\(money(spent)) of \(money(budget)) so far this month."
    content.sound = .default
    content.threadIdentifier = "budgets"
    try? await center.add(UNNotificationRequest(identifier: key, content: content, trigger: nil))
  }

  private static func money(_ n: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.minimumFractionDigits = 2
    f.maximumFractionDigits = 2
    f.locale = Locale(identifier: "en_AE")
    return "AED \(f.string(from: NSNumber(value: n)) ?? String(format: "%.2f", n))"
  }
}
