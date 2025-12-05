import React from 'react';

interface Supplier {
	supplier_id?: string;
	supplier_name?: string;
	price_cents?: number;
	url?: string;
	in_stock?: boolean;
	shipping_days?: number;
}

interface PartData {
	name?: string;
	oem_part_number?: string;
	suppliers?: Supplier[];
	x?: number;
	y?: number;
}

interface SpatialPartPopupProps {
	part: PartData;
	onClose: () => void;
	onOrder: (supplier: Supplier) => void;
}

// Minimal popup for selecting a supplier; positions not strictly used here.
const SpatialPartPopup: React.FC<SpatialPartPopupProps> = ({ part, onClose, onOrder }) => {
	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0,0,0,0.5)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 10040
			}}
			onClick={onClose}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					background: 'white',
					border: '1px solid #d1d5db',
					padding: 16,
					minWidth: 320,
					maxWidth: 520
				}}
			>
				<div style={{ fontWeight: 700, marginBottom: 8, fontSize: '10pt' }}>
					{part.name || 'Part'}
				</div>
				{part.oem_part_number && (
					<div style={{ fontSize: '9pt', color: '#374151', marginBottom: 8 }}>
						Part #: {part.oem_part_number}
					</div>
				)}
				<div style={{ marginBottom: 12 }}>
					<div style={{ fontSize: '9pt', marginBottom: 6 }}>Suppliers</div>
					<div style={{ display: 'grid', gap: 6 }}>
						{(part.suppliers || []).map((s, idx) => (
							<button
								key={idx}
								onClick={() => onOrder(s)}
								className="button"
								style={{ fontSize: '8pt', textAlign: 'left' }}
							>
								{(s.supplier_name || 'Supplier')} {typeof s.price_cents === 'number' ? `- $${(s.price_cents / 100).toFixed(2)}` : ''}
							</button>
						))}
						{(part.suppliers || []).length === 0 && (
							<div style={{ fontSize: '8pt', color: '#6b7280' }}>No suppliers available</div>
						)}
					</div>
				</div>
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
					<button className="button" style={{ fontSize: '8pt' }} onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
};

export default SpatialPartPopup;


