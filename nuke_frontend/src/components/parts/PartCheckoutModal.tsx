import React from 'react';

interface PartCheckoutModalProps {
	isOpen: boolean;
	part: any;
	onClose: () => void;
	onSuccess: (purchaseId: string) => void;
}

// Minimal checkout modal placeholder. Calls onSuccess with a dummy id.
const PartCheckoutModal: React.FC<PartCheckoutModalProps> = ({ isOpen, part, onClose, onSuccess }) => {
	if (!isOpen) return null;

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0,0,0,0.6)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 10060
			}}
			onClick={onClose}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					background: 'var(--surface)',
					border: '1px solid #d1d5db',
					padding: 16,
					minWidth: 320,
					maxWidth: 520
				}}
			>
				<div style={{ fontWeight: 700, marginBottom: 8, fontSize: '10pt' }}>Checkout</div>
				<div style={{ fontSize: '9pt', marginBottom: 12 }}>
					{part?.name || 'Selected Part'}
				</div>
				<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
					<button className="button" style={{ fontSize: '8pt' }} onClick={onClose}>
						Cancel
					</button>
					<button
						className="button button-primary"
						style={{ fontSize: '8pt' }}
						onClick={() => {
							onSuccess(`purchase_${Date.now()}`);
							onClose();
						}}
					>
						Purchase
					</button>
				</div>
			</div>
		</div>
	);
};

export default PartCheckoutModal;


