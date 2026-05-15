/**
 * config.js — PMS 프론트엔드 설정 파일
 *
 * ⚠️ 배포 환경에 맞게 아래 값을 수정하세요.
 * - backendPort: FastAPI 서버 포트 (기본 8000)
 *   → 다른 포트를 사용한다면 이 값을 변경하세요.
 *   → IP는 자동 감지(접속한 브라우저 주소 기반)되므로 별도 설정 불필요.
 *
 * 예시:
 *   백엔드를 8080 포트로 실행한다면 → backendPort: 8080
 */
window.PMS_CONFIG = {
  backendPort: 8000,
};
