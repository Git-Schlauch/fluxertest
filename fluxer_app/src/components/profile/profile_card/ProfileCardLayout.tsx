/*
 * Copyright (C) 2026 Fluxer Contributors
 *
 * This file is part of Fluxer.
 *
 * Fluxer is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Fluxer is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Fluxer. If not, see <https://www.gnu.org/licenses/>.
 */

import styles from '@app/components/profile/profile_card/ProfileCardLayout.module.css';
import {Trans} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';

interface ProfileCardLayoutProps {
	borderColor: string;
	profileEffectUrl?: string | null;
	showPreviewLabel?: boolean;
	hoverRef?: (instance: HTMLDivElement | null) => void;
	children: React.ReactNode;
}

export const ProfileCardLayout: React.FC<ProfileCardLayoutProps> = observer(
	({borderColor, profileEffectUrl, showPreviewLabel = false, hoverRef, children}) => {
		const hasProfileEffect = Boolean(profileEffectUrl);

		return (
			<div>
				{showPreviewLabel && (
					<div className={styles.previewLabel}>
						<Trans>Profile Preview</Trans>
					</div>
				)}

				<div ref={hoverRef} className={clsx(styles.profileCard, hasProfileEffect && styles.profileCardWithEffect)} style={{borderColor}}>
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
