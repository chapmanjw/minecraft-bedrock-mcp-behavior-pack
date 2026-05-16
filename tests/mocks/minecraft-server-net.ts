// Test mock for `@minecraft/server-net`. The poll loop is tested against a fake
// BridgeTransport, so these are minimal stand-ins kept only so the vitest alias
// has a resolvable target.

export const HttpRequestMethod = {
  Get: "Get",
  Head: "Head",
  Post: "Post",
  Put: "Put",
  Delete: "Delete",
  Patch: "Patch",
} as const;

export class HttpHeader {
  constructor(
    public key: string,
    public value: string,
  ) {}
}

export class HttpRequest {
  method: string = HttpRequestMethod.Get;
  body = "";
  headers: HttpHeader[] = [];
  timeout = 0;
  constructor(public uri: string) {}
}

export class HttpResponse {
  request = new HttpRequest("");
  status = 0;
  body = "";
  headers: HttpHeader[] = [];
}

export const http = {
  request(): Promise<HttpResponse> {
    return Promise.reject(new Error("http.request is not available under test"));
  },
};
