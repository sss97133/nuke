import React from 'react';

interface PartEnrichmentModalProps {
	isOpen: boolean;
	tag: { id: string; tag_name?: string; vehicle_id?: string } | null;
	onClose: () => void;
	onSave: () => void;
}

// Minimal placeholder to satisfy build until the full modal is provided.
// Renders a basic dialog with the tag name and Save/Close actions.
const PartEnrichmentModal: React.FC<PartEnrichmentModalProps> = ({ isOpen, tag, onClose, onSave }) => {
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
				zIndex: 10050
			}}
			onClick={onClose}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					background: 'var(--surface)',
					border: '1px solid #d1d5db',
					borderRadius: 0,
					padding: 16,
					minWidth: 320,
					maxWidth: 520
				}}
			>
				<div style={{ marginBottom: 8, fontWeight: 700, fontSize: '10pt' }}>Enrich Part</div>
				<div style={{ fontSize: '9pt', marginBottom: 12 }}>
					{tag?.tag_name ? `Tag: ${tag.tag_name}` : 'No tag selected'}
				</div>
				<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
					<button className="button" style={{ fontSize: '8pt' }} onClick={onClose}>
						Close
					</button>
					<button
						className="button button-primary"
						style={{ fontSize: '8pt' }}
						onClick={() => {
							onSave();
							onClose();
						}}
					>
						Save
					</button>
				</div>
			</div>
		</div>
	);
};

export default PartEnrichmentModal;


