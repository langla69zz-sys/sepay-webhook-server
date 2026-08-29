// api/sepay-webhook.js
// Nhận webhook từ SePay mỗi khi có tiền chuyển vào tài khoản ngân hàng của shop,
// tự động khớp với đúng yêu cầu nạp tiền đang chờ duyệt và cộng tiền vào ví khách —
// không cần admin bấm duyệt tay nữa.
//
// PROJECT NÀY TÁCH RIÊNG KHỎI PROJECT SHOP — cập nhật/deploy lại shop sẽ KHÔNG đụng
// tới project này, nên webhook không còn bị gián đoạn theo shop nữa.
//
// SỬA NGÀY: dùng Firebase ADMIN SDK (qua Service Account) thay vì gọi fetch() trần
// vào Firebase — vì kể từ khi Firebase Rules yêu cầu "auth != null", các lệnh ghi
// bằng fetch() không đăng nhập trước đó bị từ chối (Permission Denied), khiến webhook
// báo lỗi liên tục dù code logic không sai. Admin SDK dùng Service Account nên được
// Firebase cho phép bỏ qua Rules một cách an toàn (chỉ server này giữ khoá, không lộ).
//
// Biến môi trường cần có trong Vercel > Settings > Environment Variables:
//   SEPAY_API_KEY         - khoá bí mật do BẠN tự đặt, dán cùng giá trị này vào cấu
//                            hình webhook bên SePay để họ gửi kèm khi gọi tới đây.
//   FIREBASE_DB_URL       - https://shopquytula-default-rtdb.asia-southeast1.firebasedatabase.app
//   FIREBASE_PROJECT_ID   - lấy từ file Service Account JSON, trường "project_id"
//   FIREBASE_CLIENT_EMAIL - lấy từ file Service Account JSON, trường "client_email"
//   FIREBASE_PRIVATE_KEY  - lấy từ file Service Account JSON, trường "private_key"
//                            (giữ nguyên các dấu \n trong chuỗi)

import admin from 'firebase-admin';

// Khởi tạo Admin SDK đúng 1 lần duy nhất (Vercel có thể tái sử dụng cùng 1 tiến trình
// cho nhiều request liên tiếp — khởi tạo lại nhiều lần sẽ gây lỗi).
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Biến môi trường không giữ được ký tự xuống dòng thật, SePay/Vercel lưu nó
      // dưới dạng chuỗi "\n" hai ký tự — cần đổi lại thành ký tự xuống dòng thật.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DB_URL,
  });
}

const db = admin.database();
const SHOP_ID = 'shopquytula_main';

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

  try {
    // 2) Tách tên đăng nhập từ nội dung chuyển khoản, đúng quy ước "NAP <tên đăng nhập>"
    //    mà trang shop đang yêu cầu khách ghi khi chuyển khoản.
    const match = content.match(/NAP\s+([a-zA-Z0-9_.]+)/i);
    if (!match) {
      return res.status(200).json({ success: true, message: 'Không tìm thấy mã người dùng trong nội dung CK' });
    }
    const username = match[1];

    // 3) Chống xử lý trùng khi SePay gửi lại (retry) đúng 1 webhook — SePay khuyến
    //    nghị kiểm tra tính duy nhất theo trường "id" của họ.
    const dedupRef = db.ref(`shops/${SHOP_ID}/sepayProcessed/${sepayTxId}`);
    const alreadySnap = await dedupRef.once('value');
    if (alreadySnap.val()) {
      return res.status(200).json({ success: true, message: 'Giao dịch đã xử lý trước đó' });
    }

    // 4) Tìm đúng giao dịch nạp tiền đang "pending" khớp cả username LẪN số tiền.
    const txSnap = await db.ref(`shops/${SHOP_ID}/tx`).once('value');
    const txData = txSnap.val() || {};
    const matchId = Object.keys(txData).find((id) => {
      const t = txData[id];
      return t.type === 'deposit' && t.status === 'pending' && t.code === username && Number(t.amount) === amount;
    });

    if (!matchId) {
      return res.status(200).json({ success: true, message: 'Không khớp yêu cầu nạp tiền nào đang chờ duyệt' });
    }

    // 5) Duyệt giao dịch + cộng tiền vào ví khách (dùng transaction để tránh cộng sai
    //    nếu 2 webhook chạy trùng thời điểm).
    await db.ref(`shops/${SHOP_ID}/tx/${matchId}`).update({
      status: 'confirmed',
      note: 'Tự động duyệt qua SePay',
    });

    await db.ref(`shops/${SHOP_ID}/core/users/${username}/balance`).transaction((cur) => (Number(cur) || 0) + amount);

    // 6) Đánh dấu đã xử lý để không cộng tiền 2 lần nếu SePay gửi lại webhook này.
    await dedupRef.set(true);

    return res.status(200).json({ success: true, message: `Đã cộng ${amount} vào ví ${username}` });
  } catch (err) {
    console.error('sepay-webhook error:', err);
    return res.status(500).json({ success: false, message: 'Internal error', detail: String(err && err.message || err) });
  }
}
