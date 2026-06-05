const { execSync } = require('child_process');

console.log("=========================================");
console.log("   Memulai Proses Auto-Update Keseluruhan");
console.log("=========================================\n");

try {
    // Menjalankan build.js dengan flag --all agar otomatis memproses semua folder novel
    execSync('node build.js --all', { stdio: 'inherit' });
    console.log("\n✅ Auto-Update selesai dengan sukses!");
} catch (error) {
    console.error("\n❌ Terjadi kesalahan saat proses Auto-Update.");
    process.exit(1);
}
