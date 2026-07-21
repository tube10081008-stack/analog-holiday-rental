import {
  loadInventory,
  saveInventory,
  getInventorySummary,
  reserveCamera,
  returnCamera,
  parseScheduleDates,
} from "./_lib/inventory.js";
import { getAdminKey, listReservations } from "./_lib/reservations.js";
import { json, readBody, isAuthorized } from "./_lib/utils.js";



/* ── 핸들러 ── */
export default async function handler(req, res) {

  // ─── GET: 재고 조회 ───
  if (req.method === "GET") {
    const action = req.query?.action || "summary";

    // 요약 조회 (관리자 인증 필요)
    if (action === "summary") {
      if (!isAuthorized(req)) {
        return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
      }
      try {
        const summary = await getInventorySummary();
        return json(res, 200, { ok: true, inventory: summary });
      } catch (err) {
        return json(res, 500, { ok: false, message: err.message });
      }
    }

    // 공개 조회: 고객이 예약 폼에서 카메라 목록을 볼 때
    if (action === "available") {
      const departure = req.query?.departure;
      const returnDate = req.query?.returnDate;
      try {
        const inventory = await loadInventory();
        const { isCameraAvailable } = await import("./_lib/inventory.js");

        const cameras = inventory.cameras.map((c) => ({
          id: c.id,
          name: c.name,
          mood: c.mood,
          available: departure && returnDate
            ? isCameraAvailable(c, departure, returnDate)
            : c.totalStock - c.reserved.length > 0,
        }));

        return json(res, 200, { ok: true, cameras });
      } catch (err) {
        return json(res, 500, { ok: false, message: err.message });
      }
    }

    return json(res, 400, { ok: false, message: "알 수 없는 action입니다." });
  }

  // ─── POST: 재고 조작 (관리자 전용) ───
  if (req.method === "POST") {
    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
    }

    const body = readBody(req);
    const action = body.action;

    // 카메라 홀딩 (예약에 배정)
    if (action === "reserve") {
      try {
        const result = await reserveCamera(
          body.cameraId,
          body.reservationId,
          body.departure,
          body.returnDate,
        );
        return json(res, 200, {
          ok: true,
          message: `${result.name} 홀딩 완료`,
          camera: result,
        });
      } catch (err) {
        return json(res, 400, { ok: false, message: err.message });
      }
    }

    // 카메라 반납
    if (action === "return") {
      try {
        const result = await returnCamera(body.cameraId, body.reservationId);
        return json(res, 200, {
          ok: true,
          message: `${result.name} 반납 완료`,
          camera: result,
        });
      } catch (err) {
        return json(res, 400, { ok: false, message: err.message });
      }
    }

    // ─── 재고 풀 동기화: 인벤토리 초기화 후 DB 예약 기반 완전 재구축 ───
    if (action === "sync") {
      try {
        const reservations = await listReservations();
        const inventory = await loadInventory();
        const details = [];
        let synced = 0;
        let skipped = 0;

        // 1단계: 모든 reserved 배열 초기화 (DB가 유일한 진실의 원천)
        for (const camera of inventory.cameras) {
          camera.reserved = [];
          camera.available = camera.totalStock;
        }
        for (const item of inventory.addToBox) {
          item.reserved = [];
          item.available = item.totalStock;
        }
        details.push("🔄 인벤토리 초기화 완료 — DB 기반 재구축 시작");

        // 2단계: DB 예약을 순회하며 홀딩 재구축
        for (const rsv of reservations) {
          if (!rsv.cameraId || !rsv.schedule) {
            skipped++;
            continue;
          }

          const parsed = parseScheduleDates(rsv.schedule);
          if (!parsed) {
            details.push(`⚠️ ${rsv.name} — 일정 파싱 실패 (${rsv.schedule})`);
            skipped++;
            continue;
          }

          // 카메라 홀딩
          const camera = inventory.cameras.find(c => c.id === rsv.cameraId);
          if (camera) {
            camera.reserved.push({
              reservationId: rsv.id,
              departure: parsed.departure,
              returnDate: parsed.returnDate,
            });
            camera.available = camera.totalStock - camera.reserved.length;
            synced++;
            details.push(`✅ ${camera.name} ← ${rsv.name} (${parsed.departure} ~ ${parsed.returnDate})`);
          } else {
            details.push(`⚠️ ${rsv.name} — 카메라 ID "${rsv.cameraId}" 인벤토리에 없음`);
            skipped++;
          }

          // Add-to-box 홀딩
          const boxItem = inventory.addToBox.find(b => b.id === "add-to-box-kit");
          if (boxItem) {
            const boxCount = 1 + (parseInt(rsv.extraBox, 10) || 0);
            for (let i = 0; i < boxCount; i++) {
              boxItem.reserved.push({
                reservationId: `${rsv.id}_box_${i}`,
                departure: parsed.departure,
                returnDate: parsed.returnDate,
              });
            }
            boxItem.available = boxItem.totalStock - boxItem.reserved.length;
          }
        }

        await saveInventory(inventory);

        const summaryMsg = `카메라 ${synced}건, 여행 소품 박스 전체가 재배정되었습니다.`;
        return json(res, 200, {
          ok: true,
          message: summaryMsg,
          synced,
          skipped,
          details,
          inventory: {
            cameras: inventory.cameras.map(c => ({ name: c.name, reserved: c.reserved.length, available: c.available })),
            addToBox: inventory.addToBox.map(b => ({ name: b.name, reserved: b.reserved.length, available: b.available })),
          }
        });
      } catch (err) {
        return json(res, 500, { ok: false, message: err.message });
      }
    }

    return json(res, 400, { ok: false, message: "알 수 없는 action입니다." });
  }

  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { ok: false, message: "허용되지 않은 메서드입니다." });
}
