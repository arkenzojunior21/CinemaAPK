// Smoke test alur lengkap terhadap server demo in-memory (`npm run demo`).
// Pemakaian: node tools/demo-smoke.mjs
const B = process.env.DEMO_BASE ?? 'http://localhost:3000/api/v1';
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const trace = [];
let token = '';

async function call(method, path, body) {
  const res = await fetch(B + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  const fail = json.success === false ? ` ${json.error?.code}` : '';
  trace.push(`${res.status}${fail}  ${method} ${path}`);
  return json;
}

const rp = (v) => new Intl.NumberFormat('id-ID').format(v ?? 0);

const login = await call('POST', '/auth/login', { email: 'demo@cinegen.id', password: 'demo1234' });
token = login?.data?.tokens?.access_token;
const me = await call('GET', '/auth/me');
const movies = await call('GET', '/movies?limit=8');
const movie = (movies?.data?.items ?? []).find((m) => m.status === 'now_showing');
await call('GET', `/movies/${movie.id}`);
const st = await call('GET', `/movies/${movie.id}/showtimes?date=${tomorrow}`);
const group = st?.data?.groups?.[0];
const showtime = group?.showtimes?.[0];
const seatMap = await call('GET', `/showtimes/${showtime.id}`);
const free = (seatMap?.data?.seats ?? []).filter((s) => s.status === 'available').slice(0, 3);
const lock = await call('POST', `/showtimes/${showtime.id}/seat-locks`, { seat_ids: free.map((s) => s.id) });
const booking = await call('POST', '/bookings', {
  showtime_id: showtime.id,
  seat_reservation_ids: (lock?.data?.locks ?? []).map((l) => l.reservation_id),
});
const bid = booking?.data?.id;
const fnbItems = await call('GET', `/cinemas/${group?.cinema?.id}/fnb-items`);
const order = await call('POST', `/bookings/${bid}/fnb-orders`, {
  items: [{ fnb_item_id: fnbItems?.data?.[0]?.id, quantity: 2 }],
});
const split = await call('POST', `/bookings/${bid}/split-bills`, {
  method: 'equal',
  participants: [{ name: 'Penonton Demo' }, { name: 'Budi' }, { name: 'Sari' }],
});
const bill = await call('GET', `/split-bills/${split?.data?.id}`);
const parts = bill?.data?.participants ?? [];

const bayaran = [];
for (const p of parts) {
  const chg = await call('POST', `/bookings/${bid}/payments`, { channel: 'qris', participant_id: p.id });
  const sim = await call('POST', `/payments/${chg?.data?.id}/simulate`);
  bayaran.push({ nama: p.name, share: p.share_amount, effect: sim?.data?.effect, booking: sim?.data?.booking_status });
  await call('GET', `/split-bills/${split?.data?.id}`);
}

const after = await call('GET', `/bookings/${bid}`);
const ticket = await call('GET', `/bookings/${bid}/ticket`);
const quiz = await call('POST', '/ai/quiz', {
  mood: 'keluarga', favorite_genres: ['Animation'], max_duration_minutes: 150, companion: 'keluarga', limit: 3,
});
const chat = await call('POST', '/ai/chat', { message: 'Film aksi yang sedang tayang apa?' });
const list = await call('GET', '/bookings?page=1');

console.log(trace.join('\n'));

const total = after?.data?.totals?.grand_total ?? bill?.data?.total_amount;
const sumShare = parts.reduce((a, p) => a + p.share_amount, 0);
console.log('\n===== HASIL =====');
console.log('user          :', me?.data?.email, '| token', token ? 'ya' : 'TIDAK');
console.log('film & jadwal :', movie?.title, '@', group?.cinema?.name, `${showtime?.studio} ${showtime?.starts_at?.slice(11, 16)}`);
console.log('kursi & lock  :', free.map((s) => `${s.row}${s.number}`).join(','), '| expires', lock?.data?.expires_at?.slice(11, 19));
console.log('booking       :', bid, 'status', booking?.data?.status, '| kode', booking?.data?.booking_code);
console.log('F&B order     :', order?.success === false ? JSON.stringify(order?.error) : `total ${rp(order?.data?.total_amount)} pickup ${order?.data?.pickup_code}`);
console.log('grand total   :', rp(total), '| shares', parts.map((p) => `${p.name} ${rp(p.share_amount)}`).join(' + '));
console.log('invarian uang :', sumShare === total ? `OK (jumlah share = grand_total = ${rp(total)})` : `BEDA! sum=${sumShare} grand=${total}`);
console.log('pembayaran    :', JSON.stringify(bayaran));
console.log('booking akhir :', after?.data?.status, '| paid_at', after?.data?.paid_at);
console.log('e-ticket      :', ticket?.success === false ? JSON.stringify(ticket?.error)
  : `${ticket?.data?.ticket?.code} | qr ${String(ticket?.data?.ticket?.qr_payload).slice(0, 46)}.. | fnb ${(ticket?.data?.fnb_orders ?? []).length}`);
console.log('ai quiz       :', (quiz?.data?.recommendations ?? []).length, 'rek', quiz?.data?.engine, '| rationale:', String(quiz?.data?.recommendations?.[0]?.rationale).slice(0, 60));
console.log('ai chat       :', chat?.success === false ? JSON.stringify(chat?.error) : String(chat?.data?.reply).slice(0, 60));
console.log('daftar booking:', (list?.data?.items ?? []).length, 'item');
