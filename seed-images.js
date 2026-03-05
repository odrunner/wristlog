// ══════════════════════════════════════════════════════════════════════════════
//  WRISTLOG — DEMO ACCOUNT IMAGE SEEDER
// ══════════════════════════════════════════════════════════════════════════════
//  1. Log into the demo account (watchdemo) on wrotate.com or localhost
//  2. Open browser DevTools → Console
//  3. Paste this entire script and press Enter
//  4. Wait for all images to upload (~30-60 seconds)
// ══════════════════════════════════════════════════════════════════════════════

(async () => {
  if (!currentUser) { console.error('❌ Not logged in!'); return; }
  const uid = currentUser.id;
  console.log(`🔧 Seeding images for user ${uid}...`);

  // ── Watch images (keyed by ref number) ──
  const watchImages = {
    '126610LN':              'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/m126610ln0001_1678721112.jpg',
    '310.30.42.50.01.002':   'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/31030425001002_1626105221.jpg',
    'M79030N':               'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/m79030n0001_1565802282.jpg',
    'SBGA211':               'https://teddybaldassarre.com/cdn/shop/files/SBGA211_grande.webp?v=1691207056',
    'IW371605':              'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/iw371605_1577117774.jpg',
    'WSSA0029':              'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/wssa0029_1583167307.jpg',
    '126710BLNR':            'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/m126710blnr0002_1652292020.jpg',
    'Q3858520':              'https://s.turbifycdn.com/aah/movadobaby/jaeger-lecoultre-reverso-classic-large-small-second-q3858520-66.jpg',
    'SRPB43':                'https://teddybaldassarre.com/cdn/shop/files/1_d6d1684a-8c03-4bd4-afbc-aa6ac6cec524_1000x.jpg?v=1738268354',
    'GA-2100-1A1':           'https://feldmarwatch.com/wp-content/uploads/2020/10/GA21-00-1A1.jpg',
    '03.3100.3600':          'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/033100360021m3100_1648152750.jpg',
    'PAM01312':              'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/pam01312_1542986740.jpg',
  };

  // ── Wishlist images (keyed by ref number) ──
  const wishImages = {
    '380.032':               'https://www.prestigetime.com/images/watches/380-032_main.jpg',
    '5227G':                 'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/5227g010.jpg',
    '210.30.42.20.03.001':   'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/21030422003001_1546968914.jpg',
    '164':                   'https://www.prestigetime.com/images/watches/164_brand_main.jpg',
    'AB0137211B1A1':         'https://res.cloudinary.com/dp9dnliwc/image/upload/w_650,h_800,c_pad/q_auto:best/f_auto/wmmedia/watch_images/large/ab0137211b1a1_1666799988.jpg',
    '6902-1200':             'https://d2j6dbq0eux0bg.cloudfront.net/images/16115183/1246884508.jpg',
  };

  // ── Fetch + upload helper ──
  async function fetchAndUpload(imageUrl, storagePath) {
    // Try direct fetch first, then CORS proxy
    const sources = [imageUrl, `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`];
    for (const src of sources) {
      try {
        const r = await fetch(src, { signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const blob = await r.blob();
          if (blob.size > 500) {
            const url = await uploadImage(blob, storagePath);
            return url;
          }
        }
      } catch (_) {}
    }
    // Fallback: just use the direct URL (hotlinked)
    console.warn(`  ⚠ Could not fetch/upload, using direct URL`);
    return imageUrl;
  }

  // ── Process watches ──
  const { data: watchRows } = await db.from('watches')
    .select('id, brand, name, ref, image')
    .eq('user_id', uid);

  let done = 0, total = (watchRows || []).length;
  for (const w of (watchRows || [])) {
    const srcUrl = watchImages[w.ref];
    if (!srcUrl) { console.log(`⏭ ${w.brand} ${w.name} — no source URL`); continue; }
    if (w.image && w.image.startsWith('https://') && !w.image.includes('watch-images/demo')) {
      console.log(`⏭ ${w.brand} ${w.name} — already has image`); done++; continue;
    }
    try {
      const uploaded = await fetchAndUpload(srcUrl, `watches/${uid}/${w.id}.jpg`);
      await db.from('watches').update({ image: uploaded }).eq('id', w.id);
      done++;
      console.log(`✅ [${done}/${total}] ${w.brand} ${w.name}`);
    } catch (e) {
      console.error(`❌ ${w.brand} ${w.name}: ${e.message}`);
    }
  }

  // ── Process wishlist ──
  const { data: wishRows } = await db.from('wishlist')
    .select('id, brand, name, ref, image')
    .eq('user_id', uid);

  let wDone = 0, wTotal = (wishRows || []).length;
  for (const w of (wishRows || [])) {
    const srcUrl = wishImages[w.ref];
    if (!srcUrl) { console.log(`⏭ ${w.brand} ${w.name} — no source URL`); continue; }
    if (w.image && w.image.startsWith('https://') && !w.image.includes('watch-images/demo')) {
      console.log(`⏭ ${w.brand} ${w.name} — already has image`); wDone++; continue;
    }
    try {
      const uploaded = await fetchAndUpload(srcUrl, `wishlist/${uid}/${w.id}.jpg`);
      await db.from('wishlist').update({ image: uploaded }).eq('id', w.id);
      wDone++;
      console.log(`✅ [${wDone}/${wTotal}] WL: ${w.brand} ${w.name}`);
    } catch (e) {
      console.error(`❌ WL: ${w.brand} ${w.name}: ${e.message}`);
    }
  }

  // Refresh local data
  if (typeof loadFromSupabase === 'function') await loadFromSupabase();
  console.log(`\n🎉 Done! ${done} watches + ${wDone} wishlist images seeded.`);
})();
