import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 25,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"]
  }
};

export default function () {
  const response = http.get("http://127.0.0.1:8000/health");

  check(response, {
    "status is 200": (res) => res.status === 200,
    "response time < 500ms": (res) => res.timings.duration < 500
  });

  sleep(0.25);
}
