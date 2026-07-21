import {
  createReservation,
  deleteReservation,
  getAdminKey,
  getMailFrom,
  getMailMode,
  getStorageMode,
  listReservations,
  migrateBlobReservationsToPostgres,
  sendReservationNotification,
  createReservationRecord,
  saveReservationToDb,
} from "./_lib/reservations.js";
import { json, readBody, isAuthorized } from "./_lib/utils.js";

export default async function handler(request, response) {
  try {
    if (request.method === "POST") {
      const payload = readBody(request);
      const reservation = createReservationRecord(payload);

      // 재고 자동 차감 로직 (홀딩을 먼저 시도)
      if (reservation.cameraId && reservation.schedule) {
        const { parseScheduleDates } = await import("./_lib/inventory.js");
        const parsed = parseScheduleDates(reservation.schedule);
        
        if (parsed) {
          try {
            const { reserveCamera, reserveAddToBox, returnCamera } = await import("./_lib/inventory.js");
            // 1. 카메라 1대 차감
            await reserveCamera(reservation.cameraId, reservation.id, parsed.departure, parsed.returnDate);
            
            // 2. Add-to-box 차감 (기본 1개 + 추가 옵션 갯수)
            try {
              const addReqCount = 1 + (reservation.extraBox || 0);
              for (let i = 0; i < addReqCount; i++) {
                await reserveAddToBox("add-to-box-kit", `${reservation.id}_box_${i}`, parsed.departure, parsed.returnDate);
              }
            } catch (err) {
              // Add-to-box 홀딩 실패 시 카메라 홀딩 롤백
              await returnCamera(reservation.cameraId, reservation.id);
              throw new Error("여행 소품 박스 재고가 부족합니다.");
            }
          } catch (e) {
            console.error("[reservations] Inventory holding failed:", e);
            return json(response, 400, {
              ok: false,
              message: "재고가 부족하거나 일정이 겹쳐 예약을 확정할 수 없습니다. 다시 시도해주세요."
            });
          }
        } else {
          console.warn(`[reservations] ⚠️ 일정 파싱 실패 — 재고 차감 건너뜀! schedule="${reservation.schedule}", cameraId="${reservation.cameraId}"`);
        }
      }

      // 재고 차감이 확인되면 DB에 최종 저장한다.
      await saveReservationToDb(reservation);

      // 디스코드 보고 (리나 웹훅)
      try {
        const discordWebhookUrl = process.env.DISCORD_WEBHOOK_LINA || "";
        const extraBoxMsg = reservation.extraBox ? ` (추가 소품 박스 ${reservation.extraBox}개)` : '';
        const content = `🚨 **[신규 주문 접수]**\n> **고객명**: ${reservation.name}\n> **일정**: ${reservation.schedule}\n> **카메라ID**: ${reservation.cameraId || '미선택'}${extraBoxMsg}\n> **여행지**: ${reservation.destination}\n> **요청무드**: ${reservation.mood || '-'}\n\n꼼꼼하게 챙겨두겠습니다! - *물류사원 리나*`;
        await fetch(discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "물류사원 리나",
            avatar_url: "https://analog-holiday-mall.vercel.app/assets/lina-avatar.png",
            content 
          })
        });
      } catch (e) {
        console.error("[reservations] Discord notification failed:", e);
      }

      let emailResult = {
        sent: false,
        reason: "not_attempted",
      };

      try {
        emailResult = await sendReservationNotification(reservation);
      } catch (error) {
        emailResult = {
          sent: false,
          reason: "mail_send_failed",
          message: error.message,
        };
      }

      return json(response, 201, {
        ok: true,
        message: emailResult.sent
          ? "예약이 저장되었고 메일 알림도 전송되었습니다."
          : "예약이 저장되었습니다.",
        reservation: {
          id: reservation.id,
          createdAt: reservation.createdAt,
          service: reservation.service,
        },
        storageMode: getStorageMode(),
        mail: emailResult,
      });
    }

    if (request.method === "GET") {
      if (!isAuthorized(request)) {
        return json(response, 401, {
          ok: false,
          message: "관리자 인증이 필요합니다.",
        });
      }

      // [더미 데이터 시드용 코드 추가] 배포된 환경(Vercel Blob)에 테스트용 10건 데이터 강제 주입
      if (request.query?.action === "seed") {
        const dummyPayloads = [
          { name: "홍길동", email: "hong@example.com", phone: "010-1111-2222", schedule: "2026/04/15 출국 ~ 2026/04/20 귀국", destination: "일본 도쿄", mood: "시티팝 감성의 도쿄 밤거리를 힙하게 남기고 싶어요.", reserveService: "퀵 렌탈 예약" },
          { name: "김영희", email: "young@example.com", phone: "010-3333-4444", schedule: "2026/04/11 출국 ~ 2026/04/14 귀국", destination: "베트남 다낭", mood: "파란 하늘과 바다의 청량함을 가득 담고 싶어요. 색감이 쨍한 코닥 카메라 제안해주세요.", reserveService: "퀵 렌탈 예약" },
          { name: "이철수", email: "chul@example.com", phone: "010-5555-6666", schedule: "2026/04/05 출국 ~ 2026/04/08 귀국", destination: "대만 타이베이", mood: "옛날 영화 같은 빈티지한 골목길 느낌을 원해요. 필름 노이즈가 많았으면 좋겠습니다.", reserveService: "퀵 렌탈 예약" },
          { name: "박지민", email: "park@example.com", phone: "010-7777-8888", schedule: "2026/04/01 출국 ~ 2026/04/03 귀국", destination: "제주도", mood: "가족 여행입니다. 따뜻하고 몽환적인 분위기의 결과물이 나오면 좋겠어요.", reserveService: "퀵 렌탈 예약" },
          { name: "최동욱", email: "choi@example.com", phone: "010-9999-0000", schedule: "2026/04/12 출국 ~ 2026/04/18 귀국", destination: "미국 뉴욕", mood: "뉴욕의 차가운 도시적인 매력을 담고 싶어요. 야간 촬영을 많이 할 것 같습니다.", reserveService: "퀵 렌탈 예약" },
          { name: "강태리", email: "kang@example.com", phone: "010-1234-5678", schedule: "2026/04/20 출국 ~ 2026/04/25 귀국", destination: "프랑스 파리", mood: "비오는 파리의 거리를 유럽 영화의 한 장면처럼 찍고 싶어요. 야시카를 고민 중입니다.", reserveService: "퀵 렌탈 예약" },
          { name: "윤아름", email: "yoon@example.com", phone: "010-8765-4321", schedule: "2026/04/08 출국 ~ 2026/04/11 귀국", destination: "태국 방콕", mood: "야시장의 화려한 불빛과 강렬한 색채를 포토콜라 카메라로 담고 싶네요.", reserveService: "퀵 렌탈 예약" },
          { name: "임나연", email: "lim@example.com", phone: "010-2345-6789", schedule: "2026/03/25 출국 ~ 2026/03/29 귀국", destination: "홍콩", mood: "왕가위 영화 중경삼림 특유의 거칠고 네온사인 느낌 나는 색감을 꼭 살려주세요!", reserveService: "퀵 렌탈 예약" },
          { name: "정수정", email: "jung@example.com", phone: "010-3456-7890", schedule: "2026/04/15 출국 ~ 2026/04/19 귀국", destination: "스페인 바르셀로나", mood: "햇살 가득한 해변과 가우디 건축물을 따뜻하고 밝게 찍고 싶어요.", reserveService: "퀵 렌탈 예약" },
          { name: "오민석", email: "oh@example.com", phone: "010-4567-8901", schedule: "2026/04/02 출국 ~ 2026/04/05 귀국", destination: "부산 해운대", mood: "일회용 카메라 특유의 흐릿한 감성과 물빠진 색감으로 아날로그 틱하게 담아볼게요.", reserveService: "퀵 렌탈 예약" }
        ];
        // 비동기 처리
        await Promise.all(dummyPayloads.map(p => createReservation(p)));
        return json(response, 200, { ok: true, message: "10건의 더미 데이터가 Vercel Blob에 시딩되었습니다." });
      }

      const reservations = await listReservations();

      return json(response, 200, {
        ok: true,
        reservations,
        storageMode: getStorageMode(),
        mailMode: getMailMode(),
        mailFrom: getMailFrom(),
      });
    }

    if (request.method === "PATCH") {
      if (!isAuthorized(request)) {
        return json(response, 401, {
          ok: false,
          message: "관리자 인증이 필요합니다.",
        });
      }

      const payload = readBody(request);

      if (payload.action !== "migrate-to-postgres") {
        return json(response, 400, {
          ok: false,
          message: "지원하지 않는 관리자 작업입니다.",
        });
      }

      const migration = await migrateBlobReservationsToPostgres();

      return json(response, 200, {
        ok: true,
        message: "Blob 예약 데이터를 Postgres로 이전했습니다.",
        migration,
        storageMode: getStorageMode(),
      });
    }

    if (request.method === "DELETE") {
      if (!isAuthorized(request)) {
        return json(response, 401, {
          ok: false,
          message: "관리자 인증이 필요합니다.",
        });
      }

      const payload = readBody(request);
      const reservationId = payload.id || request.query?.id;

      if (!reservationId) {
        return json(response, 400, { ok: false, message: "삭제할 예약 ID가 필요합니다." });
      }

      // ── 인벤토리 홀딩 해제 (삭제 전 실행) ──
      try {
        const { releaseReservationHolds } = await import("./_lib/inventory.js");
        const released = await releaseReservationHolds(reservationId);
        console.log(`[reservations] 인벤토리 해제 완료:`, released);
      } catch (invErr) {
        console.error("[reservations] 인벤토리 해제 중 오류 (계속 진행):", invErr);
        // 인벤토리 해제 실패해도 예약 삭제는 진행
      }

      // ── DB/Blob에서 예약 삭제 ──
      const removed = await deleteReservation({
        id: reservationId,
        blobPathname: payload.blobPathname || request.query?.blobPathname,
      });

      return json(response, removed ? 200 : 404, {
        ok: removed,
        message: removed ? "예약이 삭제되었습니다." : "삭제할 예약을 찾지 못했습니다.",
      });
    }

    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return json(response, 405, {
      ok: false,
      message: "허용되지 않은 요청 메서드입니다.",
    });
  } catch (error) {
    return json(response, 500, {
      ok: false,
      message: error.message || "예약 요청 처리 중 오류가 발생했습니다.",
      storageMode: getStorageMode(),
      mailMode: getMailMode(),
    });
  }
}
