import dotenv from 'dotenv';
dotenv.config({path:'.env.local'});
dotenv.config({path:'.env.prod'});
import pg from 'pg';

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, max:2});

console.log('=== 📦 지오 최신 기억 (전체) ===');
const mem = await pool.query(
  `SELECT id, memory_type, title, importance, created_at 
   FROM agent_memories WHERE agent_id='geo' 
   ORDER BY created_at DESC LIMIT 8`
);
mem.rows.forEach(r => {
  const time = new Date(r.created_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'});
  console.log(`  [${r.memory_type}] ${r.title} (imp:${r.importance}) - ${time}`);
});

console.log('');
console.log('=== 📨 최신 공유 지식 TOP 8 ===');
const shared = await pool.query(
  `SELECT id, title, content, created_by, visible_to, created_at
   FROM shared_knowledge
   ORDER BY created_at DESC LIMIT 8`
);
shared.rows.forEach(r => {
  const time = new Date(r.created_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'});
  console.log(`  [${r.created_by}→${r.visible_to}] ${r.title}`);
  console.log(`    내용: ${r.content?.slice(0,100)}...`);
  console.log(`    시간: ${time}`);
  console.log('');
});

console.log('=== 🧠 하니가 볼 수 있는 공유 지식 ===');
const haniShared = await pool.query(
  `SELECT title, created_by, created_at FROM shared_knowledge 
   WHERE 'hani' = ANY(visible_to) OR 'all' = ANY(visible_to)
   ORDER BY created_at DESC LIMIT 5`
);
haniShared.rows.forEach(r => {
  const time = new Date(r.created_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'});
  console.log(`  📌 ${r.title} (from: ${r.created_by}, ${time})`);
});

await pool.end();
