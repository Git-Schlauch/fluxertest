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

import * as ToastActionCreators from '@app/actions/ToastActionCreators';
import bannerStyles from '@app/components/modals/tabs/my_profile_tab/BannerUploader.module.css';
import {Button} from '@app/components/uikit/button/Button';
import * as AvatarUtils from '@app/utils/AvatarUtils';
import {openFilePicker} from '@app/utils/FilePickerUtils';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useCallback} from 'react';

interface ProfileEffectUploaderProps {
	hasProfileEffect: boolean;
	onProfileEffectChange: (base64: string) => void;
	onProfileEffectClear: () => void;
	disabled?: boolean;
	errorMessage?: string;
}

export const ProfileEffectUploader = observer(
	({hasProfileEffect, onProfileEffectChange, onProfileEffectClear, disabled, errorMessage}: ProfileEffectUploaderProps) => {
		const {t} = useLingui();

		const handleProfileEffectUpload = useCallback(async () => {
			try {
				const [file] = await openFilePicker({accept: 'image/*'});
				if (!file) return;

				if (file.size > 10 * 1024 * 1024) {
					ToastActionCreators.createToast({
						type: 'error',
						children: t`File is too large. Please choose a file smaller than 10MB.`,
					});
					return;
				}

				const base64 = await AvatarUtils.fileToBase64(file);
				onProfileEffectChange(base64);
			} catch {
				ToastActionCreators.createToast({
					type: 'error',
					children: t`That image is invalid. Please try another one.`,
				});
			}
		}, [onProfileEffectChange, t]);

		return (
			<div>
				<div className={bannerStyles.label}>
					<Trans>Profile Media</Trans>
				</div>
				<div className={bannerStyles.buttonGroup}>
					<Button variant="primary" small={true} onClick={handleProfileEffectUpload} disabled={disabled}>
						<Trans>Change Media</Trans>
					</Button>
					{hasProfileEffect && (
						<Button variant="secondary" small={true} onClick={onProfileEffectClear} disabled={disabled}>
							<Trans>Remove Media</Trans>
						</Button>
					)}
				</div>
				<div className={bannerStyles.description}>
					<Trans>JPEG, PNG, GIF, WebP. Max 10MB. Appears on your profile card.</Trans>
				</div>
				{errorMessage && <p className={bannerStyles.errorMessage}>{errorMessage}</p>}
			</div>
		);
	},
);
