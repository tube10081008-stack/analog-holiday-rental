import { getAdminKey } from "./reservations.js";

/**
 * JSON 응답 헬퍼
 */
export function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

/**
 * 요청 바디 안전 파싱
 */
export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

/**
 * 관리자 인증 키 검증
 * 헤더(Authorization / x-admin-key) 또는 바디에서 키를 추출합니다.
 * 쿼리 파라미터는 액세스 로그/히스토리에 키가 남으므로 지원하지 않습니다.
 */
export function isAuthorized(req) {
  const key = getAdminKey();
  if (!key) return false;
  const provided =
    (req.headers.authorization || "").replace("Bearer ", "").trim() ||
    req.headers["x-admin-key"] ||
    readBody(req).adminKey ||
    "";
  return provided === key;
}
