"use client";

import { cn } from "@auto/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

interface AddressWithCopyProps {
	address: string;
	className?: string;
	/**
	 * Human-readable chain name (e.g. Basename) shown above the hex address when set.
	 */
	displayName?: string | null;
	href?: string;
	/** Defaults to 6 / 4. */
	trim?: { prefix: number; suffix: number };
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const isLikelyAddress = (value: string): boolean => ADDRESS_REGEX.test(value);

const trimAddress = (
	address: string,
	trim: { prefix: number; suffix: number }
) => `${address.slice(0, trim.prefix)}…${address.slice(-trim.suffix)}`;

export function AddressWithCopy({
	address,
	className,
	displayName,
	href,
	trim = { prefix: 6, suffix: 4 },
}: AddressWithCopyProps) {
	const [copied, setCopied] = useState(false);

	const display = useMemo(() => {
		if (!isLikelyAddress(address)) {
			return address;
		}
		return trimAddress(address, trim);
	}, [address, trim]);

	const copy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(address);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		} catch {
			// Swallow clipboard failures (e.g. insecure context) — user can still select text.
		}
	}, [address]);

	const AddressNode = href ? (
		<a
			className="font-mono text-[#dbc1b9] text-sm hover:text-[#f5f5f2]"
			href={href}
			rel="noopener noreferrer"
			target="_blank"
		>
			{display}
		</a>
	) : (
		<span className="font-mono text-[#dbc1b9] text-sm">{display}</span>
	);

	return (
		<div className={cn("inline-flex flex-col items-start gap-1", className)}>
			{displayName ? (
				<span className="font-manrope text-[#dbc1b9] text-sm">
					{displayName}
				</span>
			) : null}
			<div className="inline-flex items-center gap-2">
				{AddressNode}
				<button
					aria-label="Copy address"
					className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#55433d] bg-[#131313] text-[#dbc1b9] transition hover:bg-[#2a2a2a] hover:text-[#f5f5f2]"
					onClick={() => {
						copy().catch(() => {
							/* best effort */
						});
					}}
					type="button"
				>
					{copied ? (
						<CheckIcon className="h-3.5 w-3.5" />
					) : (
						<CopyIcon className="h-3.5 w-3.5" />
					)}
				</button>
			</div>
		</div>
	);
}
