# Sales dashboard preview

The Dashboard “รายงาน” shortcut opens `sales.html`. It uses the existing admin session and the admin-only `getSalesPreview` action. The snapshot is bundled under `functions/` and is deliberately excluded from Firebase Hosting.

## Source and calculation

- Source: “EASY | ฐานข้อมูลยอดขายทุกแพลตฟอร์ม”, tabs “ยอดขายทุกแพลตฟอร์ม” and “การเงินรายวัน”; snapshot date 2026-09-25.
- Completed orders include ShopeeFood/GrabFood `Completed` and LINE MAN `Delivery Order`. Cancelled orders are displayed in the list but excluded from sales and count.
- Sales = sum of order-level `ยอดขายสุทธิ`. Reported receipts = sum of daily finance `ยอดโอนให้ร้าน` plus `เงินสด/โครงการรัฐ`, scoped by the same platform/branch filters. The ratio is receipts ÷ sales; it is **not** profit.
- For ShopeeFood the payout figure is pending. GrabFood uses its finance overview. LINE MAN payouts can reflect deductions and balances. The label therefore says “ยอดรับตามรายงาน” rather than claiming that all money entered a bank account that day.
- The “สรุปรวม” top KPI currently contains the earlier ShopeeFood + LINE MAN subtotal (53 orders, ฿6,060), while its platform/branch total includes GrabFood (88 orders, ฿10,485). The preview computes from detail and daily finance rows instead.

The date arrows are disabled while the data source contains one date. This is a reviewable UI and data contract, not an automatic Google Sheets sync. To make it live, replace `getSalesPreview` with an authenticated server-side import/query keyed by date, platform, branch, and order ID. Keep the client free of Google credentials and preserve the separation between sales, reported receipts, wallet funds, and confirmed payouts.

## Product counts

- The snapshot also includes the “รายการสินค้า ShopeeFood” and “รายการสินค้า GrabFood” tabs. Product detail covers 65 of the 88 completed orders. LINE MAN has no product-level records in this workbook, so filtering to LINE MAN displays an empty product state.
- The product table counts completed order lines by menu name and size/option. Promotional prefixes and two names for Thai tea are normalized. Combo menu lines remain combo SKUs; they are not decomposed into inferred ingredients or bundled drinks.
- Drinks sold as their own lines appear under เครื่องดื่ม. Explicitly selected paid add-ons appear under ท็อปปิ้ง and are multiplied by the parent line's quantity. Free or bundled toppings mentioned in a menu title are not counted again. Product quantities and add-on quantities are therefore distinct from the order sales total.
