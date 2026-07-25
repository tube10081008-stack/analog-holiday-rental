/**
 * ⏰ 크론 통합 디스패처
 *
 * Vercel Hobby 플랜은 배포당 서버리스 함수 12개가 상한입니다.
 * 개별 크론 파일을 각각 함수로 두면 상한을 넘기므로, 실제 핸들러는
 * api/_cron/ 에 두고(언더스코어 접두사 → 함수로 인식되지 않음)
 * 이 파일 하나가 ?job= 파라미터로 분기합니다. 함수 3개 → 1개.
 *
 * 실행 시각 (vercel.json은 JSON이라 주석 불가 — 여기에 기록):
 *   ?job=daily   "0 0 * * 1-5" (UTC) = 평일 09:00 KST — 지오 물류 모닝 브리핑
 *   ?job=evening "0 9 * * 1-5" (UTC) = 평일 18:00 KST — 하니 저녁 매거진 발행
 *   ?job=weekly  "0 0 * * 1"   (UTC) = 월요일 09:00 KST — 주간 두뇌 성찰
 */

import dailyReport from "./_cron/daily-report.js";
import eveningReport from "./_cron/evening-report.js";
import weeklyReflection from "./_cron/weekly-reflection.js";

const JOBS = {
  daily: dailyReport,
  evening: eveningReport,
  weekly: weeklyReflection,
};

export default async function handler(req, res) {
  // Vercel 런타임에 따라 req.query가 비어 오는 경우 대비
  let job = req.query?.job;
  if (!job && req.url) {
    try {
      job = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("job");
    } catch { /* ignore */ }
  }

  const runner = JOBS[String(job || "")];
  if (!runner) {
    return res.status(400).json({
      ok: false,
      message: `알 수 없는 job입니다. 사용 가능: ${Object.keys(JOBS).join(", ")}`,
    });
  }

  // CRON_SECRET이 설정된 경우에만 인증을 요구합니다.
  // (Vercel Cron은 CRON_SECRET이 있을 때만 Authorization 헤더를 전송하므로,
  //  미설정 환경에서는 기존과 동일하게 동작합니다)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers?.authorization || "";
    const adminKey = req.headers?.["x-admin-key"] || "";
    const isCron = authHeader === `Bearer ${cronSecret}`;
    const isAdmin = adminKey && adminKey === (process.env.RESERVATION_ADMIN_KEY || "");
    if (!isCron && !isAdmin) {
      return res.status(401).json({ ok: false, message: "크론 또는 관리자 인증이 필요합니다." });
    }
  }

  console.log(`[Cron] ▶ job=${job} 실행`);
  return runner(req, res);
}
