import { ImageResponse } from "next/og";

export const alt = "auto.eth";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage(): ImageResponse {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "#0f0f0f",
				color: "#f5f5f2",
				padding: 64,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 28,
					maxWidth: 980,
					width: "100%",
				}}
			>
				<div
					style={{
						width: 160,
						height: 160,
						borderRadius: 24,
						background: "#131313",
						border: "1px solid #353535",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<svg
						height="120"
						viewBox="0 0 200 200"
						width="120"
						xmlns="http://www.w3.org/2000/svg"
					>
						<title>auto.eth</title>
						<rect
							fill="#1b1b1b"
							height="80"
							rx="8"
							stroke="#353535"
							strokeWidth="1"
							width="120"
							x="40"
							y="50"
						/>
						<rect fill="#d97757" height="20" rx="2" width="12" x="76" y="80" />
						<rect fill="#d97757" height="20" rx="2" width="12" x="112" y="80" />
						<rect fill="#e2e2e2" height="2" width="140" x="30" y="150" />
					</svg>
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>
						auto.eth
					</div>
					<div style={{ fontSize: 28, lineHeight: 1.25, color: "#dbc1b9" }}>
						Autonomous fund manager orchestration — create, run, and verify
						agent vaults.
					</div>
					<div
						style={{
							marginTop: 10,
							display: "flex",
							gap: 10,
							flexWrap: "wrap",
						}}
					>
						<Pill>0G</Pill>
						<Pill>Uniswap</Pill>
						<Pill>KeeperHub</Pill>
						<Pill>ENS / Basenames</Pill>
					</div>
				</div>
			</div>
		</div>,
		{
			width: size.width,
			height: size.height,
		}
	);
}

function Pill({ children }: { children: string }): React.ReactElement {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				borderRadius: 999,
				padding: "8px 14px",
				border: "1px solid #55433d",
				background: "#131313",
				color: "#f5f5f2",
				fontSize: 18,
				lineHeight: 1,
				letterSpacing: 0.2,
			}}
		>
			{children}
		</div>
	);
}
