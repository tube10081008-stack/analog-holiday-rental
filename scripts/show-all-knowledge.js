import dotenv from 'dotenv';
dotenv.config({path:'.env.local'});
dotenv.config({path:'.env.prod'});
import pg from 'pg';

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, max:2});
const nameMap = {
  hani: '🌸 하니 (마케팅/콘텐츠)',
  geo:  '📦 지오 (물류/스케줄)',
  noah: '📊 노아 (데이터/분석)',
  lina: '💬 리나 (고객 서비스)',
  alex: '🎬 알렉스 (영상/크리에이티브)'
};

const agents = ['hani','geo','noah','lina','alex'];
for (const a of agents) {
  const res = await pool.query(
    'SELECT memory_type, title, content, importance FROM agent_memories WHERE agent_id = $1 ORDER BY importance DESC',
    [a]
  );
  console.log('');
  console.log('═'.repeat(60));
  console.log(`  ${nameMap[a]} — ${res.rows.length}건의 전문 지식`);
  console.log('═'.repeat(60));
  res.rows.forEach((r, i) => {
    const stars = '★'.repeat(Math.min(r.importance, 10)) + '☆'.repeat(Math.max(0, 10 - r.importance));
    console.log(`  ${i+1}. [${r.memory_type}] ${r.title}`);
    console.log(`     중요도: ${stars} (${r.importance}/10)`);
    console.log(`     내용: ${r.content.slice(0, 150)}`);
    console.log('');
  });
}

await pool.end();
