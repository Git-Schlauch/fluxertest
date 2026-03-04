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

import styles from '@app/components/modals/tabs/components/MicTestSection.module.css';
import {useMicTest} from '@app/components/modals/tabs/hooks/useMicTest';
import {Button} from '@app/components/uikit/button/Button';
import {Trans, useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';

interface MicTestSectionProps {
	settings: {
		inputDeviceId: string;
		outputDeviceId: string;
		inputVolume: number;
		outputVolume: number;
		echoCancellation: boolean;
		noiseSuppression: boolean;
		autoGainControl: boolean;
		noiseGateThresholdDb: number;
	};
}

export const MicTestSection: React.FC<MicTestSectionProps> = observer(({settings}) => {
	const {t} = useLingui();
	const {isTesting, micLevel, peakLevel, isGateOpen, start, stop} = useMicTest(settings);

	const getMicLevelPercentage = () => {
		if (!Number.isFinite(micLevel)) return 0;

		const minDb = -60;
		const maxDb = 0;
		const clampedLevel = Math.max(minDb, Math.min(maxDb, micLevel));
		const percentage = ((clampedLevel - minDb) / (maxDb - minDb)) * 100;
		return Math.round(percentage);
	};

	const getPeakLevelPercentage = () => {
		if (!Number.isFinite(peakLevel)) return 0;

		const minDb = -60;
		const maxDb = 0;
		const clampedLevel = Math.max(minDb, Math.min(maxDb, peakLevel));
		const percentage = ((clampedLevel - minDb) / (maxDb - minDb)) * 100;
		return Math.round(percentage);
	};

	const getMicLevelColor = () => {
		const percentage = getMicLevelPercentage();
		if (percentage < 20) return 'hsl(0, 0%, 40%)';
		if (percentage < 60) return 'hsl(120, 60%, 50%)';
		if (percentage < 85) return 'hsl(45, 100%, 50%)';
		return 'hsl(0, 60%, 50%)';
	};

	const getMicStatusText = () => {
		if (!isTesting) return '';
		if (!Number.isFinite(micLevel)) return t`No Input`;

		const percentage = getMicLevelPercentage();
		if (percentage < 20) return t`Too Quiet`;
		if (percentage < 60) return t`Good`;
		if (percentage < 85) return t`Optimal`;
		return t`Too Loud`;
	};

	const getNoiseGateThresholdPercentage = () => {
		const thresholdDb = settings.noiseGateThresholdDb;
		if (thresholdDb <= -90) return null;

		const minDb = -60;
		const maxDb = 0;
		const clampedLevel = Math.max(minDb, Math.min(maxDb, thresholdDb));
		const percentage = ((clampedLevel - minDb) / (maxDb - minDb)) * 100;
		return Math.round(percentage);
	};
	const gateDisabled = settings.noiseGateThresholdDb <= -90;
	const currentLevelLabel = Number.isFinite(micLevel) ? `${micLevel.toFixed(1)} dBFS` : '-- dBFS';
	const peakLevelLabel = Number.isFinite(peakLevel) ? `${peakLevel.toFixed(1)} dBFS` : '-- dBFS';
	const gateStatusLabel = gateDisabled ? t`Disabled` : isGateOpen ? t`Open` : t`Closed`;
	const gateThresholdLabel = gateDisabled ? t`Off` : `${Math.round(settings.noiseGateThresholdDb)} dBFS`;

	return (
		<div>
			<div className={styles.label}>
				<Trans>Mic Test</Trans>
			</div>
			<div className={styles.content}>
				<Button
					variant="primary"
					fitContainer={false}
					className={styles.actionButton}
					onClick={isTesting ? stop : start}
				>
					{isTesting ? <Trans>Stop Test</Trans> : <Trans>Start Mic Test</Trans>}
				</Button>

				{isTesting && (
					<div className={styles.testInfo}>
						<div className={styles.levelInfo}>
							<span className={styles.levelLabel}>
								<Trans>Input Level</Trans>
							</span>
							<span
								className={clsx(
									styles.levelStatus,
									getMicLevelPercentage() < 20
										? styles.levelQuiet
										: getMicLevelPercentage() < 60
											? styles.levelGood
											: getMicLevelPercentage() < 85
												? styles.levelOptimal
												: styles.levelLoud,
								)}
							>
								{getMicStatusText()}
							</span>
						</div>

						<div className={styles.meterContainer}>
							<div
								className={styles.meterBar}
								style={{
									width: `${getMicLevelPercentage()}%`,
									backgroundColor: getMicLevelColor(),
								}}
							/>
							<div
								className={styles.meterPeak}
								style={{
									left: `${getPeakLevelPercentage()}%`,
								}}
							/>
							{getNoiseGateThresholdPercentage() !== null && (
								<div
									className={styles.meterGateThreshold}
									style={{
										left: `${getNoiseGateThresholdPercentage()}%`,
									}}
								>
									<span className={styles.meterGateLabel}>{`Gate @ ${Math.round(settings.noiseGateThresholdDb)} dBFS`}</span>
								</div>
							)}
						</div>
						<div className={styles.levelInfo}>
							<span className={styles.levelLabel}>
								<Trans>Current / Peak</Trans>
							</span>
							<span className={styles.levelStatus}>{`${currentLevelLabel} / ${peakLevelLabel}`}</span>
						</div>
						<div className={styles.levelInfo}>
							<span className={styles.levelLabel}>
								<Trans>Noise Gate</Trans>
							</span>
							<span
								className={clsx(
									styles.levelStatus,
									gateDisabled ? styles.levelQuiet : isGateOpen ? styles.levelGood : styles.levelLoud,
								)}
							>
								{`${gateStatusLabel} (${gateThresholdLabel})`}
							</span>
						</div>

						<p className={styles.helpText}>
							<Trans>
								Speak normally into your microphone. Meter values are shown in dBFS (0 dBFS is maximum). For less
								sensitivity, raise the gate threshold so only louder speech opens the gate.
							</Trans>
						</p>
					</div>
				)}
			</div>
		</div>
	);
});
