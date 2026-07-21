import dotenv from 'dotenv';
dotenv.config({ path: '.env.prod' });
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 1. shared_knowledge 확인
const shared = await pool.query('SELECT id, title, content, created_by, visible_to, created_at FROM shared_knowledge ORDER BY created_at DESC LIMIT 10');
console.log('=== 📦 shared_knowledge (' + shared.rows.length + '건) ===');
for (const r of shared.rows) {
  console.log();
  console.log('  ID:', r.id);
  console.log('  제목:', r.title);
  console.log('  내용:', r.content);
  console.log('  작성:', r.created_by, '/ 대상:', r.visible_to);
  console.log('  시각:', r.created_at);
}

// 2. 노아 최근 대화 확인
const noahChat = await pool.query("SELECT role, content, sender_name, created_at FROM agent_chat_history WHERE agent_id = 'noah' ORDER BY created_at DESC LIMIT 6");
console.log('\n=== 💬 노아 최근 대화 (' + noahChat.rows.length + '건) ===');
for (const r of noahChat.rows) {
  const who = r.role === 'user' ? r.sender_name || '대표' : '노아';
  console.log(`  [${who}] ${r.content.substring(0, 80)}...`);
  console.log(`    시각: ${r.created_at}`);
}

// 3. 알렉스 최근 대화 확인
const alexChat = await pool.query("SELECT role, content, sender_name, created_at FROM agent_chat_history WHERE agent_id = 'alex' ORDER BY created_at DESC LIMIT 6");
console.log('\n=== 🎬 알렉스 최근 대화 (' + alexChat.rows.length + '건) ===');
for (const r of alexChat.rows) {
  const who = r.role === 'user' ? r.sender_name || '대표' : '알렉스';
  console.log(`  [${who}] ${r.content.substring(0, 80)}...`);
  console.log(`    시각: ${r.created_at}`);
}

await pool.end();
