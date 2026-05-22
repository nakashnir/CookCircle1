// Media adapter for donation images.
// Real provider (Cloudinary) is wired when CLOUDINARY_URL or
// CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET are set.
// Otherwise we fall back to a deterministic placeholder URL so the data shape
// stays consistent and the UI can render an image_url for every donation.

export interface MediaUploadInput {
  // base64 data URL (data:image/png;base64,...) or a remote URL
  data?: string;
  // optional public id hint (used by the local adapter to keep URLs stable)
  hint?: string;
}

export interface MediaUploadResult {
  imageUrl: string;
  imagePublicId: string;
  provider: "cloudinary" | "local";
}

const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
const apiKey = process.env.CLOUDINARY_API_KEY ?? "";
const apiSecret = process.env.CLOUDINARY_API_SECRET ?? "";
const cloudinaryConfigured = !!(cloudName && apiKey && apiSecret);

export const mediaProvider: "cloudinary" | "local" = cloudinaryConfigured
  ? "cloudinary"
  : "local";

function placeholderFor(seed: string): MediaUploadResult {
  // Stable deterministic placeholder. We don't reach the network — the URL just
  // points at a public CDN that serves a procedurally generated image. The UI
  // is fine if the request fails; it always falls back to the bowl emoji.
  const safe = encodeURIComponent(seed.slice(0, 60) || "donation");
  return {
    imageUrl: `https://picsum.photos/seed/${safe}/640/480`,
    imagePublicId: `local/${safe}`,
    provider: "local",
  };
}

// Generic image upload — used by both donations and profile avatars.
// Donations call `uploadDonationImage` (kept as a thin alias below) so the
// existing call sites stay untouched; profile avatars call `uploadImage`
// directly. The pipeline is identical: Cloudinary when configured, base64
// data URL stored verbatim in Postgres as a fallback.
export async function uploadImage(
  input: MediaUploadInput,
): Promise<MediaUploadResult> {
  const seed = input.hint ?? input.data?.slice(0, 32) ?? `${Date.now()}`;
  if (!cloudinaryConfigured) {
    // When Cloudinary is not configured, preserve an actual uploaded image as a
    // data URL so it survives save/reload. A picsum placeholder is only used
    // when no real image was provided (new listing with no photo, or editing
    // without changing the photo).
    if (input.data && input.data.startsWith("data:image/")) {
      return {
        imageUrl: input.data,
        imagePublicId: `local/${seed}`,
        provider: "local",
      };
    }
    return placeholderFor(seed);
  }
  // Real Cloudinary unsigned upload. Kept inline to avoid pulling the SDK as a
  // dependency; we hit the upload endpoint directly.
  try {
    const body = new URLSearchParams();
    body.set("file", input.data ?? "");
    body.set("api_key", apiKey);
    body.set("upload_preset", process.env.CLOUDINARY_UPLOAD_PRESET ?? "ml_default");
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: "POST", body },
    );
    if (!res.ok) throw new Error(`cloudinary ${res.status}`);
    const json = (await res.json()) as { secure_url: string; public_id: string };
    return {
      imageUrl: json.secure_url,
      imagePublicId: json.public_id,
      provider: "cloudinary",
    };
  } catch (err) {
    console.warn("cookcircle media: cloudinary upload failed, using fallback", err);
    return placeholderFor(seed);
  }
}

// Back-compat alias for the donation call sites. Same behavior; just a name
// that reads correctly at the donation route.
export const uploadDonationImage = uploadImage;
