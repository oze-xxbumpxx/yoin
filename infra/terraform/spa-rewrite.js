function handler(event) {
  const request = event.request
  const accept = request.headers.accept
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    accept && accept.value.includes("text/html") &&
    !request.uri.split("/").pop().includes(".")
  ) {
    request.uri = "/index.html"
  }
  return request
}
