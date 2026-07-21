import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { list, put } from "@vercel/blob";

const DATA_DIR = path.join(process.cwd(), "data");
const INVENTORY_FILE = path.join(DATA_DIR, "inventory.json");
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

/**
 * 재고 데이터 로드
 */
export async function loadInventory() {
  if (BLOB_TOKEN) {
    try {
      const { blobs } = await list({ prefix: "inventory/inventory.json", token: BLOB_TOKEN });
      if (blobs && blobs.length > 0) {
        const latest = blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
        const fetchUrl = `${latest.url}?t=${Date.now()}`;
        const res = await fetch(fetchUrl, { cache: "no-store", headers: { "Pragma": "no-cache", "Cache-Control": "no-cache" } });
        return await res.json();
      }
    } catch (e) {
      console.error("[inventory] Blob read error:", e);
    }
  }

  try {
    const raw = await readFile(INVENTORY_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { cameras: [], addToBox: [], lastUpdated: null };
    }
    throw err;
  }
}

/**
 * 재고 데이터 저장
 */
export async function saveInventory(inventory) {
  inventory.lastUpdated = new Date().toISOString();

  if (BLOB_TOKEN) {
    await put("inventory/inventory.json", JSON.stringify(inventory, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: BLOB_TOKEN,
      contentType: "application/json"
    });
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(INVENTORY_FILE, JSON.stringify(inventory, null, 2), "utf8");
}

/**
 * 일정 문자열에서 출발일/귀국일 두 개의 YYYY-MM-DD 날짜를 안전하게 추출합니다.
 * 다양한 포맷을 지원:
 *   "2026-04-15 ~ 2026-04-20"
 *   "2026/04/15 출국 ~ 2026/04/20 귀국"
 *   "2026.04.15~2026.04.20"
 *   "2026-04-15 – 2026-04-20"
 * @returns {{ departure: string, returnDate: string } | null}
 */
export function parseScheduleDates(schedule) {
  if (!schedule) return null;
  
  // 정규식으로 YYYY-MM-DD 또는 YYYY/MM/DD 또는 YYYY.MM.DD 패턴 2개를 추출
  const datePattern = /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g;
  const matches = [...schedule.matchAll(datePattern)];
  
  if (matches.length < 2) return null;
  
  const departure = `${matches[0][1]}-${matches[0][2].padStart(2, '0')}-${matches[0][3].padStart(2, '0')}`;
  const returnDate = `${matches[1][1]}-${matches[1][2].padStart(2, '0')}-${matches[1][3].padStart(2, '0')}`;
  
  // 유효한 날짜인지 검증
  const depDate = new Date(departure);
  const retDate = new Date(returnDate);
  
  if (isNaN(depDate.getTime()) || isNaN(retDate.getTime())) {
    return null;
  }
  
  return { departure, returnDate };
}

/**
 * 현재 시점에 실제로 나가 있는(물류 버퍼 포함) 홀딩 수를 계산합니다.
 * available을 예약 총 건수가 아닌 "지금 대여 중인 수량" 기준으로 유지하기 위한 헬퍼.
 */
function countActiveHolds(reserved = []) {
  const now = Date.now();
  return reserved.filter((r) => {
    const start = new Date(r.departure).getTime() - 2 * 86400000;
    const end = new Date(r.returnDate).getTime() + 3 * 86400000;
    return now >= start && now <= end;
  }).length;
}

/**
 * 특정 카메라의 대여 가능 여부 확인
 * 날짜 범위가 겹치는 기존 예약이 있으면 불가 (앞뒤로 배송일/반납 확인의 물류 버퍼 추가: -2일, +3일)
 */
export function isCameraAvailable(camera, departure, returnDate) {
  if (!camera || camera.totalStock <= 0) return false;

  const reqDep = new Date(departure).getTime() - 2 * 86400000;
  const reqRet = new Date(returnDate).getTime() + 3 * 86400000;

  // 기간이 겹치는 예약 수 카운트
  const overlapping = (camera.reserved || []).filter((r) => {
    const rDep = new Date(r.departure).getTime() - 2 * 86400000;
    const rRet = new Date(r.returnDate).getTime() + 3 * 86400000;
    // 두 기간이 겹치는 조건: A.start <= B.end && A.end >= B.start
    return reqDep <= rRet && reqRet >= rDep;
  });

  return overlapping.length < camera.totalStock;
}

/**
 * add-to-box 아이템의 대여 가능 여부 확인
 */
export function isAddToBoxAvailable(item, departure, returnDate) {
  if (!item || item.totalStock <= 0) return false;

  const reqDep = new Date(departure).getTime() - 2 * 86400000;
  const reqRet = new Date(returnDate).getTime() + 3 * 86400000;

  const overlapping = (item.reserved || []).filter((r) => {
    const rDep = new Date(r.departure).getTime() - 2 * 86400000;
    const rRet = new Date(r.returnDate).getTime() + 3 * 86400000;
    return reqDep <= rRet && reqRet >= rDep;
  });

  return overlapping.length < item.totalStock;
}

/**
 * 카메라 예약(홀딩) — reservationId와 기간을 reserved 배열에 추가
 */
export async function reserveCamera(cameraId, reservationId, departure, returnDate) {
  const inventory = await loadInventory();
  const camera = inventory.cameras.find((c) => c.id === cameraId);

  if (!camera) {
    throw new Error(`카메라를 찾을 수 없습니다: ${cameraId}`);
  }

  if (!isCameraAvailable(camera, departure, returnDate)) {
    throw new Error(`${camera.name}은(는) 해당 기간에 이미 대여 중입니다.`);
  }

  camera.reserved.push({ reservationId, departure, returnDate });
  camera.available = Math.max(0, camera.totalStock - countActiveHolds(camera.reserved));

  await saveInventory(inventory);
  return camera;
}

/**
 * add-to-box 아이템 예약(홀딩)
 */
export async function reserveAddToBox(itemId, reservationId, departure, returnDate) {
  const inventory = await loadInventory();
  const item = inventory.addToBox.find((c) => c.id === itemId);

  if (!item) {
    throw new Error(`Add-to-box 아이템을 찾을 수 없습니다: ${itemId}`);
  }

  if (!isAddToBoxAvailable(item, departure, returnDate)) {
    throw new Error(`여행 소품 박스 재고가 해당 기간에 부족합니다.`);
  }

  item.reserved.push({ reservationId, departure, returnDate });
  item.available = Math.max(0, item.totalStock - countActiveHolds(item.reserved));

  await saveInventory(inventory);
  return item;
}

/**
 * 카메라 반납 — reserved 배열에서 해당 예약 제거
 */
export async function returnCamera(cameraId, reservationId) {
  const inventory = await loadInventory();
  const camera = inventory.cameras.find((c) => c.id === cameraId);

  if (!camera) {
    throw new Error(`카메라를 찾을 수 없습니다: ${cameraId}`);
  }

  camera.reserved = camera.reserved.filter((r) => r.reservationId !== reservationId);
  camera.available = Math.max(0, camera.totalStock - countActiveHolds(camera.reserved));

  await saveInventory(inventory);
  return camera;
}

/**
 * add-to-box 반납 — reserved 배열에서 해당 예약 ID가 포함된 홀딩 제거
 */
export async function returnAddToBox(itemId, reservationId) {
  const inventory = await loadInventory();
  const item = inventory.addToBox.find((c) => c.id === itemId);

  if (!item) {
    throw new Error(`Add-to-box 아이템을 찾을 수 없습니다: ${itemId}`);
  }

  item.reserved = item.reserved.filter((r) => r.reservationId !== reservationId);
  item.available = Math.max(0, item.totalStock - countActiveHolds(item.reserved));

  await saveInventory(inventory);
  return item;
}

/**
 * 예약 삭제 시 관련된 모든 인벤토리 홀딩을 일괄 해제하는 통합 함수.
 * reservationId를 기준으로 카메라 + Add-to-box 모든 홀딩을 제거합니다.
 * 개별 cameraId/schedule 없이도 작동합니다 (reserved 배열에서 reservationId로 검색).
 */
export async function releaseReservationHolds(reservationId) {
  const inventory = await loadInventory();
  let released = { cameras: [], boxes: [] };

  // 카메라: reservationId로 홀딩된 모든 카메라를 찾아서 해제
  for (const camera of inventory.cameras) {
    const before = camera.reserved.length;
    camera.reserved = camera.reserved.filter((r) => r.reservationId !== reservationId);
    if (camera.reserved.length < before) {
      camera.available = Math.max(0, camera.totalStock - countActiveHolds(camera.reserved));
      released.cameras.push(camera.name);
    }
  }

  // Add-to-box: reservationId_box_N 패턴으로 홀딩된 모든 박스를 찾아서 해제
  for (const item of inventory.addToBox) {
    const before = item.reserved.length;
    item.reserved = item.reserved.filter(
      (r) => r.reservationId !== reservationId && !r.reservationId.startsWith(`${reservationId}_box_`)
    );
    if (item.reserved.length < before) {
      item.available = Math.max(0, item.totalStock - countActiveHolds(item.reserved));
      released.boxes.push({ name: item.name, count: before - item.reserved.length });
    }
  }

  await saveInventory(inventory);
  return released;
}

/**
 * 재고 요약 정보 반환 (지오 대시보드 및 AI 컨텍스트용)
 */
export async function getInventorySummary() {
  const inventory = await loadInventory();
  const now = new Date().getTime();

  const cameraSummary = inventory.cameras.map((c) => {
    let currentlyRented = 0;
    c.reserved.forEach((r) => {
      const start = new Date(r.departure).getTime() - 2 * 86400000;
      const end = new Date(r.returnDate).getTime() + 3 * 86400000;
      if (now >= start && now <= end) {
        currentlyRented++;
      }
    });

    return {
      id: c.id,
      name: c.name,
      mood: c.mood,
      totalStock: c.totalStock,
      currentlyRented,
      totalReservations: c.reserved.length,
      available: c.totalStock - currentlyRented,
      reservations: c.reserved,
    };
  });

  const addToBoxSummary = inventory.addToBox.map((item) => {
    let currentlyRented = 0;
    item.reserved.forEach((r) => {
      const start = new Date(r.departure).getTime() - 2 * 86400000;
      const end = new Date(r.returnDate).getTime() + 3 * 86400000;
      if (now >= start && now <= end) {
        currentlyRented++;
      }
    });

    return {
      id: item.id,
      name: item.name,
      totalStock: item.totalStock,
      currentlyRented,
      totalReservations: item.reserved.length,
      available: item.totalStock - currentlyRented,
    };
  });

  return {
    cameras: cameraSummary,
    addToBox: addToBoxSummary,
    totalCameraTypes: inventory.cameras.length,
    totalCamerasAvailable: cameraSummary.filter((c) => c.available > 0).length,
    lastUpdated: inventory.lastUpdated,
  };
}
