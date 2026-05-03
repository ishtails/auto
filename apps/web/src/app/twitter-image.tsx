import OpenGraphImage from "./opengraph-image";

export const alt = "auto.eth";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage(): ReturnType<typeof OpenGraphImage> {
	return OpenGraphImage();
}
