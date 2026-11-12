# SmartNPV lookup tables (code → Hebrew label)

Copied from `https://github.com/haiku-code/cia-knowledge/blob/main/poc1/reference/snpv_lookups.md` on 11 November 2026. This is the code table for Smart NPV client fields.

Decodes the coded fields returned by the SmartNPV client/simulation API so a
dashboard can show human-readable values.

**Source:** In-app developer documentation, accessible while logged in at
`https://www.snpv.co.il/api/v2/guide/clients` (left menu → **API**). The page
("מפתח API") has a **קטגוריות** side panel listing every lookup table as a tab;
each tab shows a `כותרת` (label) → `ערך` (code) table and a **ייצוא לאקסל**
export button. The grey sub-label under each tab's title names the API client
field(s) the table decodes (e.g. `transaction_bank, bank`). Tables were read
directly from the rendered DOM.

The companion machine-readable file is `snpv_lookups.json`.

## Which client field each table decodes

| JSON key | Tab (Hebrew) | API field(s) it decodes | Entries |
|---|---|---|---|
| `banks` | בנקים | `transaction_bank`, `bank` | 33 |
| `loan_board` | לוח סילוקין | `loan_board` | 6 |
| `loan_type` | מסלולים | `loan_type` | 11 |
| `education` | השכלה | `education` | 9 |
| `transaction_type` | סוג עסקה | `transaction_type` | 32 |
| `marital_status` | מצב משפחתי | `marital_status` | 6 |
| `status_report` | מעמד תעסוקתי | `status_report` | 10 |
| `asset_type` | סוגי נכס | `asset_type` | 5 |
| `permissions` | סוגי הרשאות לאזור האישי | `permissions` | 3 |
| `loan_purpose` | מטרת הלוואה | `loan_purpose` | 11 |
| `anchor` | עוגן | `anchor` | 4 |
| `campaign` | קמפיינים | `campaign` | 7 (account-specific) |
| `document_type` | סוגי מסמכים להוספה לאזור האישי | `document_type` | 1 |
| `client_extra_fields` | שדות מותאמים | custom `extra_fields` keys | 7 (account-specific) |

> Note: `campaign`, `document_type` and `client_extra_fields` are
> **account/tenant-specific** (they reflect this advisor's own campaigns, custom
> fields and document templates), not global enums like the rest.

---

## banks — `transaction_bank`, `bank`

| Code | Label |
|---|---|
| 1 | מזרחי טפחות |
| 2 | לאומי |
| 3 | הפועלים |
| 4 | דיסקונט |
| 5 | איגוד |
| 6 | אוצר החייל |
| 7 | מסד |
| 8 | הבינלאומי |
| 9 | ירושלים |
| 10 | כלל |
| 11 | ללא בנק |
| 12 | מרכנתיל |
| 13 | יהב |
| 14 | פאג"י |
| 15 | בנק הדואר |
| 16 | מימון ישיר |
| 17 | הראל |
| 18 | הפניקס |
| 19 | טריא |
| 20 | קרדיטו |
| 21 | וויצ'ק |
| 22 | מנורה |
| 23 | איילון |
| 24 | הכשרה חברה לביטוח |
| 25 | וואן זירו הבנק הדיגיטלי |
| 26 | ליווי בנקאי - אחר |
| 27 | קרדיט 360 |
| 30 | קוואליטי |
| 31 | קרן גשרים |
| 32 | אלבר |
| 33 | פמה |
| 34 | פריסבי |
| 35 | לואן ווייז |

## loan_board — `loan_board` (לוח סילוקין / amortization schedule)

| Code | Label |
|---|---|
| 1 | שפיצר |
| 2 | קרן שווה |
| 3 | בלון מלא |
| 4 | בלון חלקי |
| 5 | כפי יכולתך |
| 8 | משכנתה בטוחה |

## loan_type — `loan_type` (מסלולים / tracks)

| Code | Label |
|---|---|
| 1 | פריים |
| 2 | קל"צ |
| 3 | ק"צ |
| 4 | מל"צ |
| 5 | מ"צ |
| 6 | מט"ח דולר |
| 7 | מט"ח יורו |
| 8 | מק"מ |
| 9 | זכאות |
| 10 | תוכנית חומש |
| 11 | מענק |

## education — `education`

| Code | Label |
|---|---|
| 0 | תיכוני |
| 1 | על תיכוני |
| 2 | אקדמאי |
| 3 | הכשרה מקצועית |
| 4 | ללא השכלה פורמלית |
| 5 | אחר |
| 6 | הנדסאי |
| 7 | אקדמאי תואר שני |
| 8 | אקדמאי תואר שלישי |

## transaction_type — `transaction_type` (סוג עסקה)

Note: code `0` (מחזור / refinance) is serialized by the API as an **empty
string**, so it cannot be read off `transaction_type` directly (see poc1 plan).

| Code | Label |
|---|---|
| 0 | מחזור |
| 1 | שיפוצים |
| 2 | הרחבה |
| 3 | הלוואה לכל מטרה |
| 4 | רכישה מקבלן |
| 5 | יד שניה |
| 6 | בניה עצמית |
| 7 | נדוניה |
| 8 | קבוצת רכישה |
| 9 | קבוצת בניה |
| 10 | רכישת מגרש |
| 11 | גישור |
| 12 | מכר בעקבות פסק דין |
| 13 | עסקה בתוך המשפחה |
| 15 | שיעבוד נכס קיים למטרת רכישה |
| 16 | רכישה במסגרת מחיר למשתכן |
| 17 | רכישת נכס מסחרי |
| 18 | הלוואה מסחרית/קמעונאית |
| 19 | רכישה/בניה בקיבוץ |
| 20 | רכישה מכונס |
| 21 | רכישה בנאמנות |
| 22 | משכנתה הפוכה |
| 23 | תמא 38 |
| 24 | רכישה בדיור ציבורי |
| 25 | מחזור + הרחבה |
| 26 | מחזור + שיפוצים |
| 27 | מחזור + הלוואה לכל מטרה |
| 28 | רכישה בשעבוד שני נכסים |
| 29 | בר רשות + שירותי בניה |
| 30 | בר רשות + שירותי בנייה רוויה |
| 31 | החזר הון |
| 32 | מחזור + נדוניה |

(Codes 14 not present in the source table.)

## marital_status — `marital_status` (מצב משפחתי)

| Code | Label |
|---|---|
| 0 | רווק/ה |
| 1 | נשוי/אה |
| 2 | גרוש/ה |
| 3 | אלמן/ה |
| 4 | אחר |
| 5 | ידוע/ה בציבור |

## status_report — `status_report` (מעמד תעסוקתי / employment status)

| Code | Label |
|---|---|
| 0 | עצמאי/ת |
| 1 | שכיר/ה |
| 2 | מגזר ציבורי |
| 3 | שכיר/ה בעל שליטה |
| 4 | לא מועסק/ת |
| 5 | שכיר ועצמאי |
| 6 | מלגה |
| 7 | קצבה |
| 8 | פנסיונר/ית |
| 9 | אישור מוסד תורני |

## asset_type — `asset_type` (סוגי נכס)

| Code | Label |
|---|---|
| 1 | נכס יחיד |
| 2 | נכס חלופי |
| 3 | נכס להשקעה |
| 4 | דירה ראשונה |
| 5 | נכס קיים |

## permissions — `permissions` (סוגי הרשאות לאזור האישי / personal-area permissions)

| Code | Label |
|---|---|
| 1 | נתוני לקוח וערבים |
| 2 | חתימה והעלאת מסמכים |
| 3 | נתוני העסקה |

## loan_purpose — `loan_purpose` (מטרת הלוואה)

| Code | Label |
|---|---|
| 1 | דיור |
| 2 | כל מטרה |
| 3 | שיפוצים |
| 4 | שעבוד קיים לטובת נרכש |
| 5 | גישור |
| 6 | נדוניה |
| 7 | מחזור לדיור |
| 8 | מחזור כל מטרה |
| 9 | עסקית |
| 10 | לא זוהה |
| 11 | קבוצות רכישה |

## anchor — `anchor` (עוגן)

| Code | Label |
|---|---|
| 0 | ללא |
| 1 | אג"ח |
| 2 | ריבית ממוצעת |
| 3 | ריבית ב"י |

## campaign — `campaign` (קמפיינים, account-specific)

| Code | Label |
|---|---|
| 59 | סבב 1 |
| 111 | 20/80 |
| 112 | סבב 7 |
| 206 | סבב 8 |
| 737 | סבב 11- 100 ימים של נדל"ן |
| 748 | צאט בוט - איחוד הלוואות ( לחיות בפלוס ) |
| 893 | סבב 12- 100 ימים של נדל"ן |

## document_type — `document_type` (סוגי מסמכים להוספה לאזור האישי, account-specific)

| Code | Label |
|---|---|
| 1 | כתב הסמכה |

## client_extra_fields — custom field keys (שדות מותאמים, account-specific)

Decodes the `key` of each entry in the client's custom `extra_fields`.

| Key | Field label |
|---|---|
| 6 | יש הצעות מבנקים? |
| 7 | מתי תרצו לקחת את המשכנתה |
| 8 | האם תרצו בדיקת ביטוח ללא עלות |
| 754 | הכנסות נוספות |
| 839 | טלפון נוסף |
| 914 | עבודה 2 |
| 952 | שומה 2023 |

---

## Tables present but not captured as enums

- **פרויקטים (`project`)** and **שירותים (`product`)** — tabs exist but are
  **empty** for this account (no rows).
- **אנשי קשר (`reference`)** — a contacts list (id → person/group), not a stable
  enum; it's a long account-specific roster of referrers/bankers and was not
  included in the lookup JSON. Re-pull from the contacts tab if needed.
- **לוג שימוש** — API usage log, not a lookup table.

## Coded fields with no lookup found

None outstanding among the documented enums. The only field that still cannot be
read by code value is `transaction_type = 0` (מחזור), because the API emits it as
an empty string — a serialization quirk, not a missing lookup (handled in
`derive_flags()`).
