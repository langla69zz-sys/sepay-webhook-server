// api/sepay-webhook.js
// Nhận webhook từ SePay mỗi khi có tiền chuyển vào tài khoản ngân hàng của shop,
// tự động khớp với đúng yêu cầu nạp tiền đang chờ duyệt và cộng tiền vào ví khách —
// không cần admin bấm duyệt tay nữa.
//
// PROJECT NÀY TÁCH RIÊNG KHỎI PROJECT SHOP (viet2003g) — cập nhật/deploy lại shop
// sẽ KHÔNG đụng tới project này, nên webhook không còn bị gián đoạn theo shop nữa.
//
// Yêu cầu 2 biến môi trường (cấu hình trong Vercel > Settings > Environment Variables):
//   SEPAY_API_KEY   - khoá bí mật do BẠN tự đặt, dán cùng giá trị này vào cấu hình
//                      webhook bên SePay để họ gửi kèm khi gọi tới đây (chống giả mạo).
//   FIREBASE_DB_URL - https://shopquytula-default-rtdb.asia-southeast1.firebasedatabase.app

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // 1) Xác thực nguồn gọi đến. SePay gửi kèm header:
  //    Authorization: Apikey <API_KEY_BAN_DA_DAT>
  const auth = req.headers['authorization'] || '';
  if (auth !== `Apikey ${process.env.SEPAY_API_KEY}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const body = req.body || {};
  // Chỉ xử lý tiền VÀO tài khoản, bỏ qua các dòng tiền ra.
  if (body.transferType !== 'in') {
    return res.status(200).json({ success: true, message: 'Bỏ qua giao dịch tiền ra' });
  }

  const amount = Number(body.transferAmount || 0);
  const content = String(body.content || body.description || '');
  const sepayTxId = body.id;

  // 2) Tách tên đăng nhập từ nội dung chuyển khoản, đúng quy ước "NAP <tên đăng nhập>"
  //    mà trang shop đang yêu cầu khách ghi khi chuyển khoản.
  const match = content.match(/NAP\s+([a-zA-Z0-9_.]+)/i);
  if (!match) {
    return res.status(200).json({ success: true, message: 'Không tìm thấy mã người dùng trong nội dung CK' });
  }
  const username = match[1];

  const DB = process.env.FIREBASE_DB_URL;
  const SHOP_ID = 'shopquytula_main';

  // 3) Chống xử lý trùng khi SePay gửi lại (retry) đúng 1 webhook — SePay khuyến nghị
  //    kiểm tra tính duy nhất theo trường "id" của họ.
  const dedupUrl = `${DB}/shops/${SHOP_ID}/sepayProcessed/${sepayTxId}.json`;
  const already = await (await fetch(dedupUrl)).json();
  if (already) {
    return res.status(200).json({ success: true, message: 'Giao dịch đã xử lý trước đó' });
  }

  // 4) Tìm đúng giao dịch nạp tiền đang "pending" khớp cả username LẪN số tiền.
  const txData = (await (await fetch(`${DB}/shops/${SHOP_ID}/tx.json`)).json()) || {};
  const matchId = Object.keys(txData).find((id) => {
    const t = txData[id];
    return t.type === 'deposit' && t.status === 'pending' && t.code === username && Number(t.amount) === amount;
  });

  if (!matchId) {
    return res.status(200).json({ success: true, message: 'Không khớp yêu cầu nạp tiền nào đang chờ duyệt' });
  }

  // 5) Duyệt giao dịch + cộng tiền vào ví khách.
  await fetch(`${DB}/shops/${SHOP_ID}/tx/${matchId}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed', note: 'Tự động duyệt qua SePay' }),
  });

  const curBal = Number((await (await fetch(`${DB}/shops/${SHOP_ID}/core/users/${username}/balance.json`)).json()) || 0);
  await fetch(`${DB}/shops/${SHOP_ID}/core/users/${username}/balance.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(curBal + amount),
  });

  // 6) Đánh dấu đã xử lý để không cộng tiền 2 lần nếu SePay gửi lại webhook này.
  await fetch(dedupUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(true),
  });

  return res.status(200).json({ success: true, message: `Đã cộng ${amount} vào ví ${username}` });
  }

