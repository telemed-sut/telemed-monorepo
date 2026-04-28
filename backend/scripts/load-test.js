// ============================================================
// Telemedicine Load Test — k6
// ============================================================
// Run:  k6 run load-test.js
// Stress: k6 run --vus 200 --duration 5m load-test.js
// Smoke:  k6 run --vus 5 --duration 30s load-test.js
// ============================================================

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// -----------------------------------------------------------
// Configuration — adjust for your environment
// -----------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const CONCURRENCY = parseInt(__ENV.VUS || "50", 10);
const DURATION = __ENV.DURATION || "2m";

// Error rate metric: we want < 1% errors under normal load
export const errorRate = new Rate("http_errors");

// -----------------------------------------------------------
// k6 options — realistic load profile
// -----------------------------------------------------------
export const options = {
  stages: [
    { duration: "30s", target: CONCURRENCY },          // ramp up
    { duration: DURATION, target: CONCURRENCY },        // steady state
    { duration: "30s", target: 0 },                     // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<1000"],   // 95% of requests < 1s
    http_req_failed: ["rate<0.01"],      // < 1% errors
    http_errors: ["rate<0.01"],          // < 1% custom error rate
  },
};

// -----------------------------------------------------------
// Shared test data — generated once, reused across VUs
// -----------------------------------------------------------
const testPayloads = {
  // Health check (unauthenticated)
  healthCheck: {
    url: `${BASE_URL}/health`,
    method: "GET",
  },

  // Live health check (shallow)
  liveCheck: {
    url: `${BASE_URL}/health/live`,
    method: "GET",
  },

  // Login attempt (will likely fail without real credentials, but tests auth path)
  login: {
    url: `${BASE_URL}/auth/login`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `test_user_${__VU}@loadtest.example.com`,
      password: "LoadTestPassw0rd!",
    }),
  },

  // Forgot password (tests rate limiting + email path)
  forgotPassword: {
    url: `${BASE_URL}/auth/forgot-password`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `test_user_${__VU}@loadtest.example.com`,
    }),
  },

  // Rate limit check — hit the same endpoint many times
  rateLimitProbe: {
    url: `${BASE_URL}/auth/login`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@loadtest.example.com",
      password: "wrong_password",
    }),
  },
};

// -----------------------------------------------------------
// Default scenario — every VU runs this loop
// -----------------------------------------------------------
export default function () {
  // 1. Health check (most frequent — simulates monitoring)
  const healthRes = http.get(testPayloads.healthCheck.url);
  check(healthRes, {
    "health check returns 200": (r) => r.status === 200,
    "health check body is valid": (r) => {
      const body = r.json();
      return body && body.status === "ok";
    },
  });
  errorRate.add(healthRes.status >= 400);
  sleep(0.5);

  // 2. Live health check (shallow)
  const liveRes = http.get(testPayloads.liveCheck.url);
  check(liveRes, {
    "live check returns 200": (r) => r.status === 200,
  });
  errorRate.add(liveRes.status >= 400);
  sleep(0.3);

  // 3. Login attempt (tests auth pipeline)
  const loginRes = http.post(
    testPayloads.login.url,
    testPayloads.login.body,
    { headers: testPayloads.login.headers }
  );
  check(loginRes, {
    "login returns 401 (expected)": (r) => r.status === 401,
    "login response has error detail": (r) => {
      try {
        const body = r.json();
        return body && body.detail;
      } catch {
        return false;
      }
    },
  });
  errorRate.add(loginRes.status >= 500); // 401 is expected, only 5xx counts as error
  sleep(1);

  // 4. Forgot password (tests email + rate limiting path)
  const forgotRes = http.post(
    testPayloads.forgotPassword.url,
    testPayloads.forgotPassword.body,
    { headers: testPayloads.forgotPassword.headers }
  );
  check(forgotRes, {
    "forgot password returns 200 or 429": (r) =>
      r.status === 200 || r.status === 429,
  });
  errorRate.add(forgotRes.status >= 500);
  sleep(2);

  // 5. Simulate a patient list request (if authenticated endpoints are needed,
  //    this section should be adapted with a real token from a login flow)
  // For load testing, we can test the /patients endpoint directly
  // with a pre-obtained token via __ENV.AUTH_TOKEN
  const authToken = __ENV.AUTH_TOKEN;
  if (authToken) {
    const patientsRes = http.get(`${BASE_URL}/patients?page=1&limit=20`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
    });
    check(patientsRes, {
      "patients list returns 200": (r) => r.status === 200,
      "patients response has items": (r) => {
        try {
          const body = r.json();
          return body && Array.isArray(body.items);
        } catch {
          return false;
        }
      },
    });
    errorRate.add(patientsRes.status >= 400);
    sleep(1.5);
  }
}

// -----------------------------------------------------------
// handleSummary — export results to JSON for CI integration
// -----------------------------------------------------------
export function handleSummary(data) {
  return {
    "stdout": textSummary(data, { indent: "  ", enableColors: true }),
    "./load-test-results.json": JSON.stringify(data, null, 2),
  };
}

// Simple text summary formatter
function textSummary(data, options) {
  const { indent = "", enableColors = true } = options || {};
  const httpReqs = data.metrics.http_reqs?.values?.count || 0;
  const httpFailed = data.metrics.http_req_failed?.values?.rate || 0;
  const p95 = data.metrics.http_req_duration?.values?.["p(95)"] || 0;
  const p99 = data.metrics.http_req_duration?.values?.["p(99)"] || 0;
  const errors = data.metrics.http_errors?.values?.rate || 0;
  const vus = data.metrics.vus?.values?.max || 0;

  return `${indent}=== Load Test Summary ===
${indent}Total Requests:    ${httpReqs}
${indent}Failed Requests:   ${(httpFailed * 100).toFixed(2)}%
${indent}Error Rate:        ${(errors * 100).toFixed(2)}%
${indent}P95 Latency:       ${p95.toFixed(0)}ms
${indent}P99 Latency:       ${p99.toFixed(0)}ms
${indent}Max VUs:           ${vus}
${indent}=== End Summary ===`;
}
