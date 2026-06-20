// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/user/components/profile/profile_card/ProfileCardLayout.module.css';
import {Trans} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useMemo} from 'react';

interface ProfileCardLayoutProps {
	borderColor: string;
	profileEffectUrl?: string | null;
	showPreviewLabel?: boolean;
	hoverRef?: (instance: HTMLDivElement | null) => void;
	className?: string;
	style?: React.CSSProperties;
	children: React.ReactNode;
}

export const ProfileCardLayout: React.FC<ProfileCardLayoutProps> = observer(
	({borderColor, profileEffectUrl, showPreviewLabel = false, hoverRef, className, style, children}) => {
		const cardStyle = useMemo<React.CSSProperties>(() => ({...style, borderColor}), [borderColor, style]);
		const hasProfileEffect = Boolean(profileEffectUrl);
		return (
			<div data-flx="user.profile.profile-card.profile-card-layout.div">
				{showPreviewLabel && (
					<div className={styles.previewLabel} data-flx="user.profile.profile-card.profile-card-layout.preview-label">
						<Trans>Profile preview</Trans>
					</div>
				)}
				<div
					ref={hoverRef}
					className={clsx(styles.profileCard, hasProfileEffect && styles.profileCardWithEffect, className)}
					style={cardStyle}
					data-flx="user.profile.profile-card.profile-card-layout.profile-card"
				>
					{hasProfileEffect && (
						<div
							className={styles.profileEffectBackground}
							style={{backgroundImage: `url("${(profileEffectUrl as string).replace(/"/g, '\\"')}")`}}
							aria-hidden="true"
						/>
					)}
					{hasProfileEffect && <div className={styles.profileEffectOverlay} aria-hidden="true" />}
					{children}
				</div>
			</div>
		);
	},
);
