export async function api(path, { method = "GET", body, portal = "therapist", patientId } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Chanre-Portal": portal,
      ...(patientId ? { "X-Chanre-Patient-Id": patientId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map(item => item.msg).join("; ") : `Request failed (${response.status})`);
  }
  return result;
}
