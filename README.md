# SePay Webhook Server (tách riêng khỏi shop)

Project này CHỈ chứa webhook nhận thông báo từ SePay để tự động duyệt nạp tiền.
Không chứa code shop. Vì tách riêng, mỗi lần bạn cập nhật/deploy lại shop
(project `viet2003g`), webhook này sẽ **không bị ảnh hưởng gì cả**.

## Bước 1 — Đưa code này lên GitHub (repo mới)

1. Vào GitHub, tạo repo mới, ví dụ đặt tên: `sepay-webhook-server`
2. Upload 2 file trong thư mục này lên repo đó:
   - `api/sepay-webhook.js`
   - `package.json`

   (Có thể dùng nút "Add file > Upload files" trên GitHub, kéo thả cả thư mục
   `api` và file `package.json` vào, rồi bấm Commit.)

## Bước 2 — Deploy repo đó thành project Vercel MỚI

1. Vào Vercel > **Add New... > Project**
2. Chọn Import repo `sepay-webhook-server` bạn vừa tạo
3. Vercel tự nhận diện, cứ bấm **Deploy** (không cần chỉnh gì thêm)
4. Sau khi deploy xong, bạn sẽ có 1 domain mới, ví dụ:
   `https://sepay-webhook-server.vercel.app`

## Bước 3 — Cấu hình biến môi trường

Vào project mới đó > **Settings > Environment Variables**, thêm đúng 2 biến
(copy y hệt giá trị đang dùng ở project `viet2003g` cũ):

| Tên biến          | Giá trị                                                                 |
|-------------------|--------------------------------------------------------------------------|
| `SEPAY_API_KEY`   | (khoá bạn đã đặt, xem lại ở project viet2003g cũ nếu quên)                |
| `FIREBASE_DB_URL` | `https://shopquytula-default-rtdb.asia-southeast1.firebasedatabase.app` |

Thêm xong bấm **Redeploy** 1 lần để biến môi trường có hiệu lực
(Deployments > deployment mới nhất > nút "..." > Redeploy).

## Bước 4 — Trỏ SePay sang webhook mới

Vào **SePay > Webhooks > Sửa webhook "Xác thực thanh toán"**, đổi:

- URL nhận webhook: `https://sepay-webhook-server.vercel.app/api/sepay-webhook`
  (thay cho URL cũ `https://viet2003g.vercel.app/api/sepay-webhook`)

Bấm **Cập nhật**.

## Bước 5 — Test thử

Chuyển khoản thử một khoản nhỏ với nội dung `NAP <tendangnhap>` đúng số tiền
một giao dịch nạp đang "pending" trong shop, xem có tự động cộng ví không.
Có thể xem log tại Vercel > project `sepay-webhook-server` > tab **Logs**.

## Từ nay về sau

- Cập nhật code SHOP: chỉ push/deploy project `viet2003g` như cũ, không đụng gì
  tới project webhook này.
- Cập nhật WEBHOOK (nếu cần sửa logic duyệt tiền sau này): chỉ push vào repo
  `sepay-webhook-server`, hoàn toàn tách biệt.
