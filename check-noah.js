import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.prod" });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    // 1. 노아의 전체 기억 조회
    const memories = await pool.query(
      `SELECT id, memory_type, title, content, importance, tags, created_at 
       FROM agent_memories 
       WHERE agent_id = 'noah' 
       ORDER BY created_at DESC`
    );

    console.log(`\n🧠 노아의 기억 (총 ${memories.rows.length}개):`);
    console.log("─".repeat(70));

    for (const m of memories.rows) {
      const date = new Date(m.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      const isSeed = m.id.startsWith("mem_noah_17789279"); // 시드 데이터 ID 패턴
      const tag = isSeed ? "📚 대학원시드" : "💬 대화추출";
      console.log(`\n  ${tag} [${m.memory_type}] ★${m.importance}`);
      console.log(`  제목: ${m.title}`);
      console.log(`  내용: ${m.content}`);
      console.log(`  생성: ${date}`);
    }

    // 2. 공유 지식 테이블에서 노아 관련 항목 조회
    const shared = await pool.query(
      `SELECT id, category, title, content, created_by, visible_to, created_at 
       FROM shared_knowledge 
       WHERE created_by = 'noah' OR 'noah' = ANY(visible_to)
       ORDER BY created_at DESC`
    );

    console.log(`\n\n🌐 노아 관련 공유 지식 (총 ${shared.rows.length}개):`);
    console.log("─".repeat(70));

    for (const s of shared.rows) {
      const date = new Date(s.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      console.log(`\n  [${s.category}] ${s.title}`);
      console.log(`  내용: ${s.content}`);
      console.log(`  작성: ${s.created_by} → 열람: ${s.visible_to}`);
      console.log(`  생성: ${date}`);
    }

  } catch (err) {
    console.error("❌ 조회 실패:", err.message);
  } finally {
    await pool.end();
  }
}

check();
