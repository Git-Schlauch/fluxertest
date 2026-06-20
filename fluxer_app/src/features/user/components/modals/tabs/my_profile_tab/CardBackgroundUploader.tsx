// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	ANIMATED_IMAGE_FORMATS,
	CARD_BACKGROUND_ASPECT_RATIO_LABEL,
	CARD_BACKGROUND_MINIMUM_SIZE_LABEL,
	IMAGE_MAX_SIZE_LABEL,
} from '@app/features/app/config/I18nDisplayConstants';
import type {Gif} from '@app/features/expressions/commands/GifCommands';
import {AssetCropModal, AssetType} from '@app/features/expressions/components/modals/AssetCropModal';
import {openAssetSourceModal} from '@app/features/expressions/components/modals/AssetSourceModal';
import {getAcceptString} from '@app/features/expressions/utils/AssetFormatCopy';
import {formatImageUploadMinimumHint} from '@app/features/expressions/utils/AssetUploadHintCopy';
import {downloadGifAsImageFile} from '@app/features/expressions/utils/GifFileDownload';
import {isSvgFile, readImageFileAsUploadDataUrl} from '@app/features/expressions/utils/ImageUploadFileUtils';
import {
	FAILED_TO_PROCESS_CROPPED_IMAGE_DESCRIPTOR,
	INVALID_IMAGE_TRY_ANOTHER_DESCRIPTOR,
} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {openFilePicker} from '@app/features/messaging/utils/FilePickerUtils';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import styles from '@app/features/user/components/modals/tabs/my_profile_tab/BannerUploader.module.css';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import {showUserErrorModal} from '@app/features/user/utils/UserErrorModalUtils';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useCallback} from 'react';

const CARD_BACKGROUND_FILE_IS_TOO_LARGE_DESCRIPTOR = msg({
	message: 'Card background file is too large. Choose a file smaller than {imageMaxSizeLabel}.',
	comment: 'Error message in the card background uploader. Preserve {imageMaxSizeLabel}; it is inserted by code.',
});
const COULDN_T_UPLOAD_CARD_BACKGROUND_DESCRIPTOR = msg({
	message: "Couldn't upload card background",
	comment: 'Title of the error modal shown when uploading a profile card background fails.',
});
const CHANGE_CARD_BACKGROUND_DESCRIPTOR = msg({
	message: 'Change card background',
	comment: 'Title of the modal where the user picks a profile card background source.',
});

interface CardBackgroundUploaderProps {
	hasBackground: boolean;
	onBackgroundChange: (base64: string) => void;
	onBackgroundClear: () => void;
	disabled?: boolean;
	errorMessage?: string;
}

export const CardBackgroundUploader = observer(
	({hasBackground, onBackgroundChange, onBackgroundClear, disabled, errorMessage}: CardBackgroundUploaderProps) => {
		const {i18n} = useLingui();
		const processBackgroundFile = useCallback(
			async (file: File) => {
				if (file.size > 10 * 1024 * 1024) {
					showUserErrorModal(
						i18n._(COULDN_T_UPLOAD_CARD_BACKGROUND_DESCRIPTOR),
						i18n._(CARD_BACKGROUND_FILE_IS_TOO_LARGE_DESCRIPTOR, {
							imageMaxSizeLabel: IMAGE_MAX_SIZE_LABEL,
						}),
					);
					return;
				}
				const svg = isSvgFile(file);
				const base64 = svg ? await readImageFileAsUploadDataUrl(file) : await AvatarUtils.fileToBase64(file);
				ModalCommands.push(
					modal(() => (
						<AssetCropModal
							imageUrl={base64}
							sourceMimeType={svg ? 'image/svg+xml' : file.type}
							assetType={AssetType.PROFILE_CARD_BACKGROUND}
							onCropComplete={(croppedBlob) => {
								const reader = new FileReader();
								reader.onload = () => onBackgroundChange(reader.result as string);
								reader.onerror = () => {
									showUserErrorModal(
										i18n._(COULDN_T_UPLOAD_CARD_BACKGROUND_DESCRIPTOR),
										i18n._(FAILED_TO_PROCESS_CROPPED_IMAGE_DESCRIPTOR),
									);
								};
								reader.readAsDataURL(croppedBlob);
							}}
							onSkip={() => onBackgroundChange(base64)}
							data-flx="user.my-profile-tab.card-background-uploader.asset-crop-modal"
						/>
					)),
				);
			},
			[i18n, onBackgroundChange],
		);
		const showBackgroundUploadError = useCallback(() => {
			showUserErrorModal(
				i18n._(COULDN_T_UPLOAD_CARD_BACKGROUND_DESCRIPTOR),
				i18n._(INVALID_IMAGE_TRY_ANOTHER_DESCRIPTOR),
			);
		}, [i18n]);
		const handlePickBackgroundFile = useCallback(async () => {
			try {
				const [file] = await openFilePicker({accept: getAcceptString('banner')});
				if (!file) return;
				await processBackgroundFile(file);
			} catch {
				showBackgroundUploadError();
			}
		}, [processBackgroundFile, showBackgroundUploadError]);
		const handleSelectBackgroundGif = useCallback(
			async (gif: Gif) => {
				try {
					await processBackgroundFile(await downloadGifAsImageFile(gif));
				} catch {
					showBackgroundUploadError();
				}
			},
			[processBackgroundFile, showBackgroundUploadError],
		);
		const handleBackgroundUpload = useCallback(() => {
			openAssetSourceModal({
				title: i18n._(CHANGE_CARD_BACKGROUND_DESCRIPTOR),
				uploadHint: formatImageUploadMinimumHint(i18n, {
					formats: ANIMATED_IMAGE_FORMATS,
					maxSize: IMAGE_MAX_SIZE_LABEL,
					minimumSize: CARD_BACKGROUND_MINIMUM_SIZE_LABEL,
					aspectRatio: CARD_BACKGROUND_ASPECT_RATIO_LABEL,
				}),
				onPickUpload: handlePickBackgroundFile,
				onSelectGif: (gif) => void handleSelectBackgroundGif(gif),
			});
		}, [handlePickBackgroundFile, handleSelectBackgroundGif, i18n]);
		return (
			<div data-flx="user.my-profile-tab.card-background-uploader.div">
				<div className={styles.label} data-flx="user.my-profile-tab.card-background-uploader.label">
					<Trans>Card background</Trans>
				</div>
				<div className={styles.buttonGroup} data-flx="user.my-profile-tab.card-background-uploader.button-group">
					<Button
						variant="primary"
						small={true}
						onClick={handleBackgroundUpload}
						disabled={disabled}
						data-flx="user.my-profile-tab.card-background-uploader.button.change"
					>
						<Trans>Change background</Trans>
					</Button>
					{hasBackground && (
						<Button
							variant="secondary"
							small={true}
							onClick={onBackgroundClear}
							disabled={disabled}
							data-flx="user.my-profile-tab.card-background-uploader.button.remove"
						>
							<Trans>Remove background</Trans>
						</Button>
					)}
				</div>
				{errorMessage && (
					<p className={styles.errorMessage} data-flx="user.my-profile-tab.card-background-uploader.error-message">
						{errorMessage}
					</p>
				)}
			</div>
		);
	},
);
