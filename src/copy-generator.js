// copy-generator.js
// Generates MT subject + intro line, and Dialog title + hook copy,
// per bonus type × tone × locale.
//
// Two modes:
//   MATCHED  — tone/festival explicitly detected from record signals
//   CREATIVE — no signal; infers tone from context, returns best-fit copy
//
// Does NOT touch the BO or sheet. Output is a plain object:
//   {
//     tone,          // detected tone key
//     toneSource,    // where it came from ('campaign'|'tier'|'subtype'|'inferred')
//     dialog: { title, hook },
//     mt:     { subject, intro },
//   }
// per locale ('EN' | 'ZH' | 'ID').
//
// Usage:
//   import { generateCopy } from './copy-generator.js';
//   const copy = generateCopy(record, 'EN');
//   // copy.dialog.title, copy.mt.subject, etc.

// ── Tone keys ────────────────────────────────────────────────────────────
// festival_cny | festival_raya | festival_worldcup | festival_midyear
// vip | welcome | game_focus | general_warm | general_urgent | general_clean

// ── Copy bank ────────────────────────────────────────────────────────────
// Structure: COPY[tone][bonusType][locale] = { dialog: {title, hook}, mt: {subject, intro} }

const COPY = {

  // ── Festival: Chinese New Year ────────────────────────────────────────
  festival_cny: {
    deposit: {
      EN: {
        dialog: { title: 'Usher in Prosperity', hook: 'Reload now & multiply your fortune this CNY' },
        mt:     { subject: 'Your CNY Reload Bonus Awaits', intro: 'This Lunar New Year, every deposit brings you closer to big wins. Reload now and let fortune favour the bold.' },
      },
      ZH: {
        dialog: { title: '迎财神，翻倍赢', hook: '立即充值，让新年财运翻倍' },
        mt:     { subject: '新年充值奖励，专属等您领取', intro: '新春佳节，每一笔充值都是好运的开始。立即充值，让财神爷为您带来更多赢利！' },
      },
      ID: {
        dialog: { title: 'Sambut Kemakmuran', hook: 'Reload sekarang & lipat gandakan keberuntunganmu di Tahun Baru Imlek' },
        mt:     { subject: 'Bonus Reload Imlek Menantimu', intro: 'Di Tahun Baru Imlek ini, setiap deposit membawa keberuntungan lebih besar. Reload sekarang dan raih kemenangan berlipat ganda.' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: '🧧 Your CNY Angpao Is Here', hook: 'A New Year gift — free credits, no deposit needed' },
        mt:     { subject: 'A CNY Gift Just for You', intro: 'We\'re ringing in the Lunar New Year with a red packet just for you. Free credits, ready to claim — no deposit required.' },
      },
      ZH: {
        dialog: { title: '红包来了！', hook: '新年礼物已到，无需存款即可领取' },
        mt:     { subject: '新年红包，免费体验金等您领', intro: '新年快乐！我们为您准备了一份特别的新年红包——免费体验金，无需存款，直接领取，开启新年好运！' },
      },
      ID: {
        dialog: { title: '🧧 Angpao Imlek Untukmu', hook: 'Hadiah Tahun Baru — kredit gratis, tanpa deposit' },
        mt:     { subject: 'Hadiah Imlek Spesial Untukmu', intro: 'Selamat Tahun Baru Imlek! Kami menyiapkan angpao spesial berupa kredit gratis untukmu. Klaim sekarang tanpa deposit.' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Spin Into Abundance', hook: 'Free spins to welcome the Year of Fortune' },
        mt:     { subject: 'CNY Free Spins — Claim Yours Now', intro: 'The reels are dressed in red and gold. Your free spins are ready to roll this Lunar New Year — spin your way to fortune.' },
      },
      ZH: {
        dialog: { title: '转出好运来', hook: '新年免费旋转，旋转迎财运' },
        mt:     { subject: '新年免费旋转，好运连连', intro: '新春佳节，转轮带来好运！您的免费旋转已准备就绪，立即转动，迎接新年财运滚滚来！' },
      },
      ID: {
        dialog: { title: 'Putar Keberuntungan Imlek', hook: 'Free spin untuk menyambut Tahun Baru penuh keberuntungan' },
        mt:     { subject: 'Free Spin Imlek — Klaim Sekarang', intro: 'Reels sudah siap berputar penuh keberuntungan Imlek. Free spin kamu sudah menunggu — putar dan menangkan hadiah besar!' },
      },
    },
  },

  // ── Festival: Raya / Eid ──────────────────────────────────────────────
  festival_raya: {
    deposit: {
      EN: {
        dialog: { title: 'Raya Besar, Menang Lebih', hook: 'Top up this festive season and win bigger' },
        mt:     { subject: 'Your Raya Reload Bonus Is Here', intro: 'Celebrate Hari Raya with a bonus that matches the spirit of the season. Top up now and make this festive season your biggest win yet.' },
      },
      ZH: {
        dialog: { title: '开斋节加倍赢', hook: '节日充值，赢得更多' },
        mt:     { subject: '开斋节充值奖励等您领', intro: '在这欢庆的开斋节，每一笔充值都让您的奖励更丰厚。立即充值，共庆佳节！' },
      },
      ID: {
        dialog: { title: 'Raya Makin Meriah', hook: 'Top up sekarang dan menangkan lebih banyak di musim Lebaran' },
        mt:     { subject: 'Bonus Reload Raya Sudah Menanti', intro: 'Rayakan Hari Raya dengan bonus spesial yang setimpal dengan semangat hari kemenangan. Top up sekarang dan jadikan Raya ini penuh kemenangan!' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'A Raya Gift From Us', hook: 'Complimentary credits to celebrate the season' },
        mt:     { subject: 'Selamat Hari Raya — Here\'s a Gift', intro: 'As a token of celebration, we\'ve prepared free credits just for you. A little gift to make your Raya even sweeter — no deposit needed.' },
      },
      ZH: {
        dialog: { title: '开斋节好礼送给您', hook: '免费体验金，共庆佳节' },
        mt:     { subject: '开斋节专属礼物——免费体验金', intro: '值此开斋节之际，我们为您准备了一份特别礼物——免费体验金，无需存款，直接领取，共庆佳节！' },
      },
      ID: {
        dialog: { title: 'Hadiah Raya dari Kami', hook: 'Kredit gratis untuk merayakan Hari Kemenangan' },
        mt:     { subject: 'Hadiah Raya Spesial Untukmu', intro: 'Sebagai tanda perayaan Hari Raya, kami siapkan kredit gratis khusus untukmu. Klaim tanpa deposit dan jadikan Lebaranmu lebih istimewa!' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Raya Free Spins 🌙', hook: 'Blessings come in free spins this season' },
        mt:     { subject: 'Raya Free Spins — Ready to Roll', intro: 'This Hari Raya, the reels are spinning in your favour. Claim your free spins now and celebrate the season with every spin.' },
      },
      ZH: {
        dialog: { title: '开斋节免费旋转', hook: '节日祝福，转出好运' },
        mt:     { subject: '开斋节免费旋转，好运伴您行', intro: '开斋节佳节，好运与您同行！您的免费旋转已准备就绪，立即转动，赢取节日大奖！' },
      },
      ID: {
        dialog: { title: 'Free Spin Spesial Raya 🌙', hook: 'Berkah Lebaran hadir dalam bentuk free spin' },
        mt:     { subject: 'Free Spin Raya — Klaim Sekarang', intro: 'Di Hari Raya ini, keberuntungan ada di pihakmu. Klaim free spin sekarang dan rayakan kemenangan di setiap putaran!' },
      },
    },
  },

  // ── Festival: World Cup ───────────────────────────────────────────────
  festival_worldcup: {
    deposit: {
      EN: {
        dialog: { title: 'Back Your Team. Boost Your Bet.', hook: 'Reload now and ride the match-day momentum' },
        mt:     { subject: 'Match Day Bonus — Reload & Play', intro: 'The world is watching. Make every match count with a deposit bonus behind you. Reload now and play like a champion.' },
      },
      ZH: {
        dialog: { title: '力挺球队，奖励加倍', hook: '立即充值，随世界杯一起赢' },
        mt:     { subject: '世界杯充值奖励，赢出冠军气势', intro: '全球目光聚焦，每场比赛都是机会。立即充值，以冠军的姿态赢取更多奖励！' },
      },
      ID: {
        dialog: { title: 'Dukung Tim, Tingkatkan Bonus', hook: 'Reload sekarang dan ikuti momentum hari pertandingan' },
        mt:     { subject: 'Bonus Hari Pertandingan — Reload & Main', intro: 'Dunia sedang menonton. Jadikan setiap pertandingan berarti dengan bonus deposit di balikmu. Reload sekarang dan main seperti juara!' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'Kick Off with Free Credits ⚽', hook: 'No deposit needed — just claim and play' },
        mt:     { subject: 'Your World Cup Free Credits Are Here', intro: 'The tournament is heating up — and so are your rewards. Free credits are ready to claim. No deposit needed, just pure match-day excitement.' },
      },
      ZH: {
        dialog: { title: '免费开球，免费体验金 ⚽', hook: '无需存款，直接领取，畅玩世界杯' },
        mt:     { subject: '世界杯免费体验金，立即领取', intro: '赛事激烈进行，您的奖励也在升温。免费体验金等您领取——无需存款，直接开启世界杯激情！' },
      },
      ID: {
        dialog: { title: 'Tendang Awal dengan Kredit Gratis ⚽', hook: 'Tanpa deposit — langsung klaim dan main' },
        mt:     { subject: 'Kredit Gratis Piala Duniamu Sudah Siap', intro: 'Turnamen semakin seru — dan hadiahmu juga ikut memanas. Kredit gratis siap diklaim. Tanpa deposit, langsung rasakan keseruan hari pertandingan!' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Spin While the World Watches ⚽', hook: 'Free spins on us — every matchday' },
        mt:     { subject: 'World Cup Free Spins — Claim Now', intro: 'From the pitch to the reels — your free spins are ready for kick-off. Claim now and spin your way to match-day glory.' },
      },
      ZH: {
        dialog: { title: '世界杯转轮激战 ⚽', hook: '免费旋转，赛场外也能赢' },
        mt:     { subject: '世界杯免费旋转，立即开转', intro: '从赛场到转轮，精彩从未停歇。您的免费旋转已准备就绪，立即领取，旋出世界杯大奖！' },
      },
      ID: {
        dialog: { title: 'Putar Saat Dunia Menonton ⚽', hook: 'Free spin dari kami — setiap hari pertandingan' },
        mt:     { subject: 'Free Spin Piala Dunia — Klaim Sekarang', intro: 'Dari lapangan ke gulungan — free spinmu siap untuk kick-off. Klaim sekarang dan putar menuju kejayaan hari pertandingan!' },
      },
    },
  },

  // ── Festival: Mid-Year ────────────────────────────────────────────────
  festival_midyear: {
    deposit: {
      EN: {
        dialog: { title: 'Mid-Year, Maximum Rewards', hook: 'Halfway through the year — reload & finish strong' },
        mt:     { subject: 'Your Mid-Year Reload Bonus', intro: 'The year\'s not over yet. Reload now and make the second half count. Your mid-year bonus is ready and waiting.' },
      },
      ZH: {
        dialog: { title: '年中冲刺，赢到最后', hook: '年过一半，充值冲刺，全力赢取' },
        mt:     { subject: '年中充值奖励，下半年赢更多', intro: '年过一半，精彩才刚开始。立即充值，带着年中奖励冲刺下半年，赢取更多！' },
      },
      ID: {
        dialog: { title: 'Pertengahan Tahun, Hadiah Maksimal', hook: 'Setengah tahun berlalu — reload & selesaikan dengan kuat' },
        mt:     { subject: 'Bonus Reload Pertengahan Tahunmu', intro: 'Tahun belum berakhir. Reload sekarang dan jadikan paruh kedua tahun ini penuh kemenangan. Bonus pertengahan tahunmu sudah siap!' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'A Mid-Year Treat, On Us', hook: 'Free credits — no reason needed, just claim' },
        mt:     { subject: 'Mid-Year Free Credits Inside', intro: 'Halfway through the year, we\'re giving you something to celebrate. Free credits, just for you — no deposit, no catch.' },
      },
      ZH: {
        dialog: { title: '年中惊喜，免费送上', hook: '免费体验金，无需理由，直接领取' },
        mt:     { subject: '年中惊喜——免费体验金等您领', intro: '时光过半，惊喜加倍。我们为您准备了免费体验金——无需存款，无附加条件，直接领取，庆祝年中！' },
      },
      ID: {
        dialog: { title: 'Hadiah Pertengahan Tahun dari Kami', hook: 'Kredit gratis — tidak perlu alasan, langsung klaim' },
        mt:     { subject: 'Kredit Gratis Pertengahan Tahun Menantimu', intro: 'Di pertengahan tahun ini, kami hadir dengan hadiah istimewa. Kredit gratis khusus untukmu — tanpa deposit, tanpa syarat tersembunyi.' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Spin Into the Second Half', hook: 'Free spins to keep the momentum going' },
        mt:     { subject: 'Mid-Year Free Spins — Don\'t Miss Out', intro: 'The reels don\'t take a break — and neither do your rewards. Your mid-year free spins are here. Claim them now and keep the wins rolling.' },
      },
      ZH: {
        dialog: { title: '年中旋转，动力加倍', hook: '免费旋转，下半年势不可挡' },
        mt:     { subject: '年中免费旋转，别错过', intro: '转轮不停，奖励不止。您的年中免费旋转已就绪——立即领取，开启下半年的连胜模式！' },
      },
      ID: {
        dialog: { title: 'Putar Menuju Paruh Kedua', hook: 'Free spin untuk menjaga momentum' },
        mt:     { subject: 'Free Spin Pertengahan Tahun — Jangan Lewatkan', intro: 'Gulungan tidak pernah berhenti — begitu pula hadiahmu. Free spin pertengahan tahun sudah siap. Klaim sekarang dan terus raih kemenangan!' },
      },
    },
  },

  // ── VIP / Premium ─────────────────────────────────────────────────────
  vip: {
    deposit: {
      EN: {
        dialog: { title: 'Exclusively Yours', hook: 'A reward as premium as you are — reload now' },
        mt:     { subject: 'Your Exclusive Reload Bonus Awaits', intro: 'You\'ve earned this. As one of our most valued members, your exclusive reload bonus is ready and waiting. Top up now and claim what\'s yours.' },
      },
      ZH: {
        dialog: { title: '专属礼遇，尊享充值奖励', hook: '为尊贵会员精心准备，立即充值领取' },
        mt:     { subject: '专属充值奖励，尊贵会员限定', intro: '您的忠诚与信任，我们铭记于心。这份专属充值奖励是我们对您尊贵身份的礼遇——立即领取，彰显您的尊荣。' },
      },
      ID: {
        dialog: { title: 'Eksklusif Untukmu', hook: 'Hadiah sepremium dirimu — reload sekarang' },
        mt:     { subject: 'Bonus Reload Eksklusifmu Menanti', intro: 'Kamu sudah layak mendapatkan ini. Sebagai salah satu member paling berharga kami, bonus reload eksklusif sudah siap. Top up sekarang dan ambil yang memang milikmu.' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'A Gift Worthy of You', hook: 'Hand-picked for our most valued members' },
        mt:     { subject: 'You\'ve Been Specially Selected', intro: 'Not everyone gets this. As one of our premier members, we\'ve set aside free credits exclusively for you. A gesture of appreciation — yours to claim.' },
      },
      ZH: {
        dialog: { title: '尊享专属，礼遇非凡', hook: '专为尊贵会员甄选，免费体验金敬奉' },
        mt:     { subject: '专属免费体验金，尊贵会员礼遇', intro: '这份礼遇并非人人皆有——它专属于您。作为我们最尊贵的会员，我们为您精心预留了免费体验金，请笑纳。' },
      },
      ID: {
        dialog: { title: 'Hadiah Setara Kelasmu', hook: 'Dipilih khusus untuk member paling berharga kami' },
        mt:     { subject: 'Kamu Terpilih Secara Khusus', intro: 'Tidak semua orang mendapatkan ini. Sebagai member premier kami, kami telah menyisihkan kredit gratis eksklusif untukmu. Sebuah apresiasi — milikmu untuk diklaim.' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Spin in Style', hook: 'Premium spins reserved for players like you' },
        mt:     { subject: 'Your Exclusive Free Spins Are Ready', intro: 'The finest reels, the finest spins — reserved exclusively for you. Your complimentary spins reflect the status you\'ve earned. Claim them now.' },
      },
      ZH: {
        dialog: { title: '尊享旋转，精英专属', hook: '顶级旋转体验，专为尊贵玩家预留' },
        mt:     { subject: '专属免费旋转，尊贵会员限定领取', intro: '最顶级的转轮体验，专为您而设。这份免费旋转礼遇，正是您尊贵身份的体现——立即领取，尽享专属荣耀。' },
      },
      ID: {
        dialog: { title: 'Putar dengan Gaya', hook: 'Spin premium yang dicadangkan untuk pemain sepertimu' },
        mt:     { subject: 'Free Spin Eksklusifmu Sudah Siap', intro: 'Gulungan terbaik, putaran terbaik — dicadangkan eksklusif untukmu. Spin gratismu mencerminkan status yang telah kamu raih. Klaim sekarang.' },
      },
    },
  },

  // ── Welcome / FTD ─────────────────────────────────────────────────────
  welcome: {
    deposit: {
      EN: {
        dialog: { title: 'Welcome — Your Bonus Awaits', hook: 'Start your journey with a deposit bonus behind you' },
        mt:     { subject: 'Your Welcome Bonus Is Ready', intro: 'Welcome aboard! We\'re thrilled to have you with us. Your welcome bonus is ready to claim — top up now and start your winning journey.' },
      },
      ZH: {
        dialog: { title: '欢迎加入，首存奖励等您领', hook: '开启您的赢利之旅，从首存奖励开始' },
        mt:     { subject: '欢迎奖励已就绪，立即领取', intro: '欢迎加入我们的大家庭！为庆祝您的到来，我们为您准备了专属欢迎奖励——立即充值，开启精彩赢利旅程！' },
      },
      ID: {
        dialog: { title: 'Selamat Datang — Bonusmu Menanti', hook: 'Mulai perjalananmu dengan bonus deposit di belakangmu' },
        mt:     { subject: 'Bonus Selamat Datangmu Sudah Siap', intro: 'Selamat datang! Kami sangat senang kamu bergabung. Bonus selamat datang siap diklaim — top up sekarang dan mulai perjalanan kemenanganmu.' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'Welcome Gift — Just for You', hook: 'Free credits to kick off your journey with us' },
        mt:     { subject: 'A Welcome Gift From Us', intro: 'We\'re so glad you\'re here. To celebrate your arrival, we\'ve prepared a welcome gift of free credits — no deposit needed. Explore and enjoy!' },
      },
      ZH: {
        dialog: { title: '新会员专属欢迎礼', hook: '免费体验金，开启您的精彩旅程' },
        mt:     { subject: '欢迎礼——新会员免费体验金', intro: '很高兴您的加入！为迎接您的到来，我们准备了新会员专属免费体验金——无需存款，直接领取，探索无限可能！' },
      },
      ID: {
        dialog: { title: 'Hadiah Selamat Datang Untukmu', hook: 'Kredit gratis untuk memulai perjalananmu bersama kami' },
        mt:     { subject: 'Hadiah Selamat Datang dari Kami', intro: 'Kami sangat senang kamu sudah di sini. Untuk merayakan kedatanganmu, kami siapkan kredit gratis sebagai hadiah — tanpa deposit. Jelajahi dan nikmati!' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Welcome — Start Spinning!', hook: 'Free spins to kick off your adventure' },
        mt:     { subject: 'Welcome Free Spins — Claim Yours', intro: 'Your journey starts here. We\'ve loaded up some free spins to get you going — no deposit needed. Spin, explore, and discover what awaits.' },
      },
      ZH: {
        dialog: { title: '欢迎加入，旋转开启好运', hook: '免费旋转，您的精彩旅程从这里开始' },
        mt:     { subject: '新会员欢迎免费旋转', intro: '您的精彩旅程从这里开始！我们为您准备了免费旋转——无需存款，立即领取，转出属于您的幸运！' },
      },
      ID: {
        dialog: { title: 'Selamat Datang — Mulai Putar!', hook: 'Free spin untuk memulai petualanganmu' },
        mt:     { subject: 'Free Spin Selamat Datang — Klaim Milikmu', intro: 'Perjalananmu dimulai di sini. Kami sudah menyiapkan free spin untuk memulaimu — tanpa deposit. Putar, jelajahi, dan temukan apa yang menanti.' },
      },
    },
  },

  // ── General: Warm ─────────────────────────────────────────────────────
  general_warm: {
    deposit: {
      EN: {
        dialog: { title: 'More In, More to Win', hook: 'Top up now and watch your balance grow' },
        mt:     { subject: 'Your Reload Bonus Is Ready', intro: 'Every deposit is an opportunity. Top up today and let your bonus do the heavy lifting — more in means more to win.' },
      },
      ZH: {
        dialog: { title: '充得多，赢得多', hook: '立即充值，余额翻倍增长' },
        mt:     { subject: '充值奖励已就绪，立即领取', intro: '每一笔充值都是机会。立即充值，让奖励助您一臂之力——充得多，赢得更多！' },
      },
      ID: {
        dialog: { title: 'Lebih Banyak Masuk, Lebih Banyak Menang', hook: 'Top up sekarang dan lihat saldo-mu tumbuh' },
        mt:     { subject: 'Bonus Reload-mu Sudah Siap', intro: 'Setiap deposit adalah peluang. Top up hari ini dan biarkan bonusmu bekerja keras — semakin banyak masuk, semakin banyak menang.' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'A Little Something From Us', hook: 'Free credits — no deposit, no catch' },
        mt:     { subject: 'Free Credits Inside — Just for You', intro: 'Consider this our way of saying thank you. Free credits, ready to play — no deposit required, no strings attached.' },
      },
      ZH: {
        dialog: { title: '小小心意，大大惊喜', hook: '免费体验金，无需存款，无附加条件' },
        mt:     { subject: '免费体验金——专属您的小礼物', intro: '这是我们向您表达感谢的方式。免费体验金，随时可用——无需存款，无任何附加条件。' },
      },
      ID: {
        dialog: { title: 'Sedikit Hadiah dari Kami', hook: 'Kredit gratis — tanpa deposit, tanpa syarat' },
        mt:     { subject: 'Kredit Gratis di Dalam — Khusus Untukmu', intro: 'Anggap ini cara kami mengucapkan terima kasih. Kredit gratis siap dimainkan — tanpa deposit, tanpa syarat apapun.' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'The Reels Are Calling', hook: 'Your free spins are loaded and ready' },
        mt:     { subject: 'Your Free Spins Are Ready to Roll', intro: 'The reels are set, the spins are free — all that\'s missing is you. Claim your free spins now and let the good times spin.' },
      },
      ZH: {
        dialog: { title: '转轮在召唤您', hook: '您的免费旋转已就绪，等待出发' },
        mt:     { subject: '免费旋转，随时可转', intro: '转轮已就位，旋转完全免费——只差您来了。立即领取免费旋转，开启精彩时刻！' },
      },
      ID: {
        dialog: { title: 'Gulungan Sedang Memanggil', hook: 'Free spin-mu sudah siap dan menunggu' },
        mt:     { subject: 'Free Spin-mu Siap Berputar', intro: 'Gulungan sudah siap, putaran gratis — yang kurang hanya kamu. Klaim free spin-mu sekarang dan biarkan keseruan bergulir.' },
      },
    },
  },

  // ── VM Exclusive (VIP Manager campaigns — KN_ / VM requestor) ───────────
  vm_exclusive: {
    deposit: {
      EN: {
        dialog: { title: 'VIP Exclusive Gift', hook: 'Deposit now and claim your exclusive bonus' },
        mt:     { subject: 'Your Exclusive Reward is Here', intro: 'A special bonus has been reserved just for you. Deposit now to unlock your exclusive reward and make the most of every ringgit.' },
      },
      ZH: {
        dialog: { title: 'VIP尊享礼遇', hook: '立即存款，领取您的专属奖金' },
        mt:     { subject: '您的专属奖励已到来', intro: '一份专属奖励已为您准备好。立即存款，解锁您的专属礼遇，让每一分钱都发挥最大价值。' },
      },
      ID: {
        dialog: { title: 'Hadiah Eksklusif VIP', hook: 'Deposit sekarang dan klaim bonus eksklusifmu' },
        mt:     { subject: 'Hadiah Eksklusifmu Sudah Tiba', intro: 'Bonus spesial telah disiapkan khusus untukmu. Deposit sekarang untuk membuka hadiahmu dan manfaatkan setiap rupiah semaksimal mungkin.' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'VIP Exclusive Gift', hook: 'Free credits — no deposit, reserved just for you' },
        mt:     { subject: 'Your Exclusive Reward is Here', intro: 'A free credit has been reserved exclusively for you. No deposit required — simply claim it and start playing.' },
      },
      ZH: {
        dialog: { title: 'VIP尊享礼遇', hook: '免费彩金——无需存款，专属为您准备' },
        mt:     { subject: '您的专属奖励已到来', intro: '一份专属免费彩金已为您准备好。无需存款——直接领取即可开始游戏。' },
      },
      ID: {
        dialog: { title: 'Hadiah Eksklusif VIP', hook: 'Kredit gratis — tanpa deposit, khusus untukmu' },
        mt:     { subject: 'Hadiah Eksklusifmu Sudah Tiba', intro: 'Kredit gratis telah disiapkan khusus untukmu. Tanpa deposit — langsung klaim dan mulai bermain.' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'VIP Exclusive Gift', hook: 'Free spins reserved exclusively for you' },
        mt:     { subject: 'Your Exclusive Reward is Here', intro: 'Your free spins have been reserved exclusively for you. No deposit required — claim them now and let the reels spin.' },
      },
      ZH: {
        dialog: { title: 'VIP尊享礼遇', hook: '免费旋转——专属为您准备' },
        mt:     { subject: '您的专属奖励已到来', intro: '您的免费旋转已专属为您准备好。无需存款——立即领取，让转轮旋转起来。' },
      },
      ID: {
        dialog: { title: 'Hadiah Eksklusif VIP', hook: 'Free spin khusus untukmu' },
        mt:     { subject: 'Hadiah Eksklusifmu Sudah Tiba', intro: 'Free spin-mu telah disiapkan khusus untukmu. Tanpa deposit — klaim sekarang dan biarkan gulungan berputar.' },
      },
    },
  },

  // ── General: Urgent ───────────────────────────────────────────────────
  general_urgent: {
    deposit: {
      EN: {
        dialog: { title: 'Reload Now. Play Bigger.', hook: 'Don\'t let this offer pass you by' },
        mt:     { subject: 'Reload Now — Bonus Won\'t Last', intro: 'This offer has a shelf life. Reload now before it\'s gone and claim the bonus you deserve. Time is ticking — don\'t miss out.' },
      },
      ZH: {
        dialog: { title: '立即充值，尽情大玩', hook: '机不可失，错过等于亏损' },
        mt:     { subject: '立即充值——奖励不等人', intro: '此优惠有时间限制。趁现在立即充值，领取您应得的奖励。时间紧迫——别让好机会溜走！' },
      },
      ID: {
        dialog: { title: 'Reload Sekarang. Main Lebih Besar.', hook: 'Jangan biarkan penawaran ini berlalu' },
        mt:     { subject: 'Reload Sekarang — Bonus Tidak Selamanya Ada', intro: 'Penawaran ini ada batas waktunya. Reload sekarang sebelum terlambat dan klaim bonus yang kamu berhak dapatkan. Waktu terus berjalan — jangan sampai terlewat.' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'Claim Before It\'s Gone', hook: 'Free credits with an expiry — act now' },
        mt:     { subject: 'Your Free Credits Are Expiring Soon', intro: 'These free credits won\'t wait forever. Claim them now before they expire and make the most of every credit — no deposit needed.' },
      },
      ZH: {
        dialog: { title: '快领，过期作废', hook: '免费体验金有有效期——立即行动' },
        mt:     { subject: '您的免费体验金即将到期', intro: '免费体验金不会永远等待。立即领取，在到期前充分利用每一分——无需存款，立即可用。' },
      },
      ID: {
        dialog: { title: 'Klaim Sebelum Habis', hook: 'Kredit gratis ada batasnya — bertindak sekarang' },
        mt:     { subject: 'Kredit Gratismu Segera Kedaluwarsa', intro: 'Kredit gratis ini tidak akan menunggu selamanya. Klaim sekarang sebelum kedaluwarsa dan manfaatkan setiap kredit sebaik mungkin — tanpa deposit.' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Don\'t Let These Spins Expire!', hook: 'Claim before your free spins run out' },
        mt:     { subject: 'Claim Your Free Spins Before They\'re Gone', intro: 'Time is ticking. Your free spins won\'t wait forever — claim them now, get spinning, and see what fortune has in store.' },
      },
      ZH: {
        dialog: { title: '别让旋转机会白白溜走！', hook: '限时领取，过期不候' },
        mt:     { subject: '免费旋转即将过期，立即领取', intro: '时间紧迫！您的免费旋转不会永远等待——立即领取，尽情旋转，看看好运为您准备了什么！' },
      },
      ID: {
        dialog: { title: 'Jangan Biarkan Spin Ini Kedaluwarsa!', hook: 'Klaim sebelum free spin-mu habis' },
        mt:     { subject: 'Klaim Free Spin-mu Sebelum Habis', intro: 'Waktu terus berjalan. Free spin-mu tidak akan menunggu selamanya — klaim sekarang, mulai berputar, dan lihat apa yang keberuntungan siapkan untukmu.' },
      },
    },
  },

  // ── General: Clean ────────────────────────────────────────────────────
  general_clean: {
    deposit: {
      EN: {
        dialog: { title: 'Top Up & Level Up', hook: 'Your next big win starts with a reload' },
        mt:     { subject: 'Exclusive Reload Bonus — Claim Yours', intro: 'You play hard. We reward harder. Your reload bonus is ready — top up now and keep the wins coming.' },
      },
      ZH: {
        dialog: { title: '充值，升级，赢更多', hook: '您的下一个大奖从充值开始' },
        mt:     { subject: '专属充值奖励——等您来领', intro: '您全力游戏，我们全力回报。充值奖励已就绪——立即充值，让胜利持续不断。' },
      },
      ID: {
        dialog: { title: 'Top Up & Level Up', hook: 'Kemenangan besarmu berikutnya dimulai dengan reload' },
        mt:     { subject: 'Bonus Reload Eksklusif — Klaim Milikmu', intro: 'Kamu bermain keras. Kami memberi hadiah lebih keras. Bonus reload-mu sudah siap — top up sekarang dan terus raih kemenangan.' },
      },
    },
    free_credit: {
      EN: {
        dialog: { title: 'Free Credits. Real Wins.', hook: 'Claim and play — it\'s that simple' },
        mt:     { subject: 'Your Free Credits Are Waiting', intro: 'No deposit needed. Just claim your free credits, play your favourite games, and keep what you win. Simple as that.' },
      },
      ZH: {
        dialog: { title: '免费体验，真实赢利', hook: '领取即玩，就是这么简单' },
        mt:     { subject: '免费体验金等您领取', intro: '无需存款。直接领取免费体验金，畅玩您最喜爱的游戏，赢到的全归您。就是这么简单。' },
      },
      ID: {
        dialog: { title: 'Kredit Gratis. Kemenangan Nyata.', hook: 'Klaim dan main — semudah itu' },
        mt:     { subject: 'Kredit Gratismu Sedang Menunggu', intro: 'Tanpa deposit. Cukup klaim kredit gratismu, mainkan game favoritmu, dan simpan kemenanganmu. Sesederhana itu.' },
      },
    },
    free_spin: {
      EN: {
        dialog: { title: 'Free Spins. Real Wins.', hook: 'Spin now and see what luck has in store' },
        mt:     { subject: 'Free Spins Inside — Don\'t Let Them Expire', intro: 'Free to spin, real to win. Your free spins are here and ready — claim them now and let the reels do the work.' },
      },
      ZH: {
        dialog: { title: '免费旋转，真实赢利', hook: '立即旋转，看看好运为您准备了什么' },
        mt:     { subject: '免费旋转在内——别让它过期', intro: '旋转免费，赢利真实。您的免费旋转已就绪——立即领取，让转轮为您创造奇迹。' },
      },
      ID: {
        dialog: { title: 'Free Spin. Kemenangan Nyata.', hook: 'Putar sekarang dan lihat apa yang keberuntungan siapkan' },
        mt:     { subject: 'Free Spin di Dalam — Jangan Biarkan Kedaluwarsa', intro: 'Gratis untuk berputar, nyata untuk menang. Free spin-mu sudah siap — klaim sekarang dan biarkan gulungan bekerja untukmu.' },
      },
    },
  },
};

// ── Secondary enrichment ─────────────────────────────────────────────────
// When multiple promos in the same campaign share a bonus type, enrich the
// base copy with record-specific details so each promo is distinguishable.
//
// FS:      dialog title += game name  |  MT subject += spin count
// Deposit: MT subject  += bonus %     (only when bonus_rate_pct present)
// FC:      MT subject  += credit amount
//
// Called automatically by generateCopy / generateCopyAll.
// Does NOT mutate the base COPY bank — returns new objects each time.

// Strip provider code prefix from game label ("vs20olympgate - Gates of Olympus" → "Gates of Olympus")
function trimGameLabel(label) {
  if (!label) return null;
  const s = String(label).trim();
  const idx = s.indexOf(' - ');
  return idx > 0 ? s.slice(idx + 3).trim() : s;
}

const ENRICH_DIALOG_TITLE = {
  // "Spin While the World Watches ⚽" + " — Gates of Olympus"
  free_spin: {
    EN: (base, p) => {
      const game = trimGameLabel(p.game);
      return game ? `${base} — ${game}` : base;
    },
    ZH: (base, p) => {
      const game = trimGameLabel(p.game);
      return game ? `${base} — ${game}` : base;
    },
    ID: (base, p) => {
      const game = trimGameLabel(p.game);
      return game ? `${base} — ${game}` : base;
    },
  },
};

const ENRICH_MT_SUBJECT = {
  free_spin: {
    EN: (base, p) => p.spin_count ? `${p.spin_count} ${base}` : base,
    ZH: (base, p) => p.spin_count ? `${p.spin_count} 次 ${base}` : base,
    ID: (base, p) => p.spin_count ? `${p.spin_count} ${base}` : base,
  },
  deposit: {
    // 100% rate is a flat-bonus mechanic (rate 100% + max_bonus cap) — not
    // meaningful to expose to players. Only enrich when rate is a real %.
    EN: (base, p) => (p.bonus_rate_pct && p.bonus_rate_pct !== 100) ? `${base} — ${p.bonus_rate_pct}% Bonus` : base,
    ZH: (base, p) => (p.bonus_rate_pct && p.bonus_rate_pct !== 100) ? `${base} — ${p.bonus_rate_pct}% 奖励` : base,
    ID: (base, p) => (p.bonus_rate_pct && p.bonus_rate_pct !== 100) ? `${base} — Bonus ${p.bonus_rate_pct}%` : base,
  },
  free_credit: {
    EN: (base, p) => p.free_credit_amount ? `${base} — ${p.free_credit_amount} Free Credits` : base,
    ZH: (base, p) => p.free_credit_amount ? `${base} — ${p.free_credit_amount} 免费体验金` : base,
    ID: (base, p) => p.free_credit_amount ? `${base} — ${p.free_credit_amount} Kredit Gratis` : base,
  },
};

function enrichCopy(copy, btKey, loc, parsed, tone) {
  const p = parsed || {};
  const dialogEnrich = ENRICH_DIALOG_TITLE[btKey]?.[loc];
  // vm_exclusive deposit: skip rate suffix — subject is already the final copy
  const skipSubject = tone === 'vm_exclusive' && btKey === 'deposit';
  const subjectEnrich = skipSubject ? null : ENRICH_MT_SUBJECT[btKey]?.[loc];
  return {
    dialog: {
      title: dialogEnrich ? dialogEnrich(copy.dialog.title, p) : copy.dialog.title,
      hook:  copy.dialog.hook,
    },
    mt: {
      subject: subjectEnrich ? subjectEnrich(copy.mt.subject, p) : copy.mt.subject,
      intro:   copy.mt.intro,
    },
  };
}

// ── Tone inference ────────────────────────────────────────────────────────

const FESTIVAL_KEYWORDS = {
  festival_cny:       /\b(cny|chinese new year|lunar new year|新年|春节|imlek)\b/i,
  festival_raya:      /\b(raya|eid|hari raya|lebaran|ramadan)\b/i,
  festival_worldcup:  /\b(world ?cup|wc|wcf|piala dunia)\b/i,
  festival_midyear:   /\b(mid.?year|mid year|midyear|half.?year)\b/i,
};

const VIP_TIER_PATTERN = /\b(vip|gold|gld|platinum|plt|diamond|dmd|premium|elite)\b/i;
const WELCOME_PATTERN  = /\b(welcome|welc|ftd|first.?time|first deposit)\b/i;
const VM_PATTERN       = /\bVM\b/;

function inferTone(record) {
  const hay = [
    record.campaign || '',
    record.remark || '',
    record.name_details_raw || '',
    record.promo_code || '',
    record.bonus_sub_type || '',
  ].join(' ');

  // 1. Festival — highest priority
  for (const [tone, re] of Object.entries(FESTIVAL_KEYWORDS)) {
    if (re.test(hay)) return { tone, source: 'campaign' };
  }

  // 2. VM / VIP Manager campaigns (requestor=VM or campaign contains VM)
  if (VM_PATTERN.test(record.requestor || '') || VM_PATTERN.test(record.campaign || '')) {
    return { tone: 'vm_exclusive', source: 'campaign' };
  }

  // 3. VIP / tier
  if (VIP_TIER_PATTERN.test(hay)) return { tone: 'vip', source: 'tier' };

  // 4. Welcome / FTD — bonus_sub_type is authoritative when populated. The
  // free-text fields folded into `hay` (name_details_raw, promo_code) can
  // legitimately contain "FTD" as an audience-segment token (e.g. an
  // "FTD Ladder" retention sequence keyed on First-Time-Deposit cohort)
  // rather than meaning the bonus itself is a Welcome/FTD offer, so the
  // free-text pattern only runs as a fallback when bonus_sub_type is blank.
  const subType = String(record.bonus_sub_type || '').trim().toLowerCase();
  if (subType === 'welcome') return { tone: 'welcome', source: 'subtype' };
  if (!subType && WELCOME_PATTERN.test(hay)) return { tone: 'welcome', source: 'subtype' };

  // 4. Inferred — rotate across general tones based on bonus type
  const bt = String(record.bonus_type || '').toLowerCase();
  if (bt === 'free spin')   return { tone: 'general_urgent', source: 'inferred' };
  if (bt === 'free credit') return { tone: 'general_warm',   source: 'inferred' };
  return { tone: 'general_clean', source: 'inferred' };
}

function bonusTypeKey(bonusType) {
  const bt = String(bonusType || '').toLowerCase();
  if (bt.includes('free spin') || bt.includes('freespin')) return 'free_spin';
  if (bt.includes('free credit') || bt.includes('freecredit')) return 'free_credit';
  return 'deposit';
}

// ── Deposit-requirement copy correction (FC only) ────────────────────────
// Every free_credit variant above was written assuming NODEP (no min_deposit)
// and hardcodes some form of "no deposit needed" in the dialog hook and/or
// MT intro. Confirmed wrong 2026-07-10 (P030, code
// WHALE_CRM_PROBE_FC88_FTD_LOSE_3) — the first FC request this project has
// processed with a real min_deposit gate (30 MYR/SGD). Left as-is, players
// read "no deposit needed" in the intro while the same message's T&C clause
// 1 (built separately by igmp-tnc.js / the QPRO/QP2 MT renderer) correctly
// states "A minimum deposit of ... is required to claim this promotion" —
// a direct contradiction. Post-process the selected copy so the phrase only
// survives when the record genuinely has no deposit requirement. The
// specific amount/currency isn't embedded here (copy-generator has no
// currency context — that's rendered separately in the Min Deposit table
// column); this only removes the false "no deposit" claim.
function capLike(matched, replacement) {
  return /^[A-Z]/.test(matched) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

const EN_NO_DEPOSIT_PATTERNS = [
  [/no deposit,?\s*no catch/gi, (m) => capLike(m, 'a deposit is required, no catch')],
  [/no deposit,?\s*reserved just for you/gi, (m) => capLike(m, 'deposit required, reserved just for you')],
  [/no deposit\s+(?:is\s+)?needed/gi, (m) => capLike(m, 'a deposit is required')],
  [/no deposit\s+(?:is\s+)?required/gi, (m) => capLike(m, 'a deposit is required')],
  [/no deposit\b/gi, (m) => capLike(m, 'a deposit is required')], // safety net for any phrasing not matched above
];

function stripNoDepositEN(text) {
  let out = text;
  for (const [re, fn] of EN_NO_DEPOSIT_PATTERNS) out = out.replace(re, fn);
  return out;
}
function stripNoDepositZH(text) {
  return text.replace(/无需存款/g, '需先存款');
}
function stripNoDepositID(text) {
  return text.replace(/tanpa deposit/gi, (m) => capLike(m, 'deposit diperlukan'));
}
const STRIP_NO_DEPOSIT = { EN: stripNoDepositEN, ZH: stripNoDepositZH, ID: stripNoDepositID };

function applyDepositRequirement(copy, btKey, loc, parsed) {
  if (btKey !== 'free_credit') return copy;
  if (!(Number(parsed?.min_deposit) > 0)) return copy;
  const strip = STRIP_NO_DEPOSIT[loc];
  if (!strip) return copy;
  return {
    dialog: { title: copy.dialog.title, hook: strip(copy.dialog.hook) },
    mt: { subject: copy.mt.subject, intro: strip(copy.mt.intro) },
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate copy for a promo record.
 * @param {object} record  - resolved request record (bonus_type, campaign, remark, etc.)
 * @param {string} locale  - 'EN' | 'ZH' | 'ID'
 * @param {object} opts
 * @param {boolean} opts.enrich - append game/spin/amount details to title+subject (default false)
 * @returns {{ tone, toneSource, dialog: {title, hook}, mt: {subject, intro} } | null}
 */
export function generateCopy(record, locale = 'EN', { enrich = false } = {}) {
  const { tone, source: toneSource } = inferTone(record);
  const btKey = bonusTypeKey(record.bonus_type);
  const loc   = ['EN', 'ZH', 'ID'].includes(locale) ? locale : 'EN';

  const rawCopy = COPY[tone]?.[btKey]?.[loc];
  if (!rawCopy) return null;
  const copy = applyDepositRequirement(rawCopy, btKey, loc, record.parsed);

  const out = enrich ? enrichCopy(copy, btKey, loc, record.parsed, tone) : { dialog: { ...copy.dialog }, mt: { ...copy.mt } };
  return { tone, toneSource, ...out };
}

/**
 * Generate copy for all three locales at once.
 * @param {object} record
 * @param {object} opts
 * @param {boolean} opts.enrich - append game/spin/amount details (default false)
 * @returns {{ tone, toneSource, EN: {...}, ZH: {...}, ID: {...} }}
 */
export function generateCopyAll(record, { enrich = false } = {}) {
  const { tone, source: toneSource } = inferTone(record);
  const btKey = bonusTypeKey(record.bonus_type);

  const result = { tone, toneSource };
  for (const loc of ['EN', 'ZH', 'ID']) {
    const rawCopy = COPY[tone]?.[btKey]?.[loc];
    const copy = rawCopy ? applyDepositRequirement(rawCopy, btKey, loc, record.parsed) : null;
    result[loc] = copy
      ? (enrich ? enrichCopy(copy, btKey, loc, record.parsed, tone) : { dialog: { ...copy.dialog }, mt: { ...copy.mt } })
      : null;
  }
  return result;
}

/**
 * Preview: list all available tones for a bonus type.
 * Useful for dry-run output so the operator can see options.
 */
export function previewAllTones(bonusType, locale = 'EN') {
  const btKey = bonusTypeKey(bonusType);
  const loc   = ['EN', 'ZH', 'ID'].includes(locale) ? locale : 'EN';
  const rows  = [];
  for (const [tone, byBt] of Object.entries(COPY)) {
    const copy = byBt[btKey]?.[loc];
    if (!copy) continue;
    rows.push({ tone, dialog_title: copy.dialog.title, mt_subject: copy.mt.subject });
  }
  return rows;
}
