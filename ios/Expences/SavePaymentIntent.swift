import AppIntents
import Foundation
import SQLite3

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
      let status = try saveRun()
      RunLog.record(status: status, amount: amount, merchant: merchant, card: card, message: nil)
    } catch {
      let message = (error as? PaymentError)?.text ?? String(describing: error)
      RunLog.record(status: "failed", amount: amount, merchant: merchant, card: card, message: message)
      throw error
    }
    return .result()
  }

  /// Returns "saved" or "duplicate"; throws with a readable message on failure.
  private func saveRun() throws -> String {
    guard let value = PaymentParser.amount(amount) else {
      throw PaymentError.message("Couldn't read the amount \"\(amount)\".")
    }
    let name = (merchant ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let merchantName = name.isEmpty ? "Apple Pay" : name
    let cardName = (card ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    // If only Amount was filled (often with the whole Shortcut Input), keep the raw text.
    let note: String? = name.isEmpty ? amount : nil

    let saved = try ExpenseStore.save(
      amount: value,
      currency: PaymentParser.currency(amount),
      merchant: merchantName,
      card: cardName.isEmpty ? nil : cardName,
      category: PaymentParser.category(merchantName),
      note: note
    )
    return saved ? "saved" : "duplicate"
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

  static func save(
    amount: Double, currency: String, merchant: String, card: String?, category: String,
    note: String?
  ) throws -> Bool {
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
    if isDuplicate { return false }

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
    sqlite3_bind_text(stmt, 5, category, -1, transient)
    if let note { sqlite3_bind_text(stmt, 6, note, -1, transient) } else { sqlite3_bind_null(stmt, 6) }
    sqlite3_bind_int64(stmt, 7, now)
    guard sqlite3_step(stmt) == SQLITE_DONE else {
      throw PaymentError.message("Couldn't save the payment: \(String(cString: sqlite3_errmsg(db)))")
    }

    // First successful automation run → the app shows "auto-logging is on".
    try exec(db, "INSERT OR IGNORE INTO meta (key, value) VALUES ('auto_log_since', '\(now)')")
    return true
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
      phrases: ["Save a payment in \(.applicationName)"],
      shortTitle: "Save Payment",
      systemImageName: "creditcard"
    )
  }
}
