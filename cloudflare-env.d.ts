declare namespace Cloudflare {
  interface Env {
    HACKER_TIMES_OWNER_EMAIL?: string;
    HACKER_TIMES_EDITOR_MUTATIONS_ENABLED?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
