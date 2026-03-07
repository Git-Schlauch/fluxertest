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

/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import {hasPermission} from '@fluxer/admin/src/AccessControlList';
import {searchAuditLogs} from '@fluxer/admin/src/api/Audit';
import {getErrorMessage} from '@fluxer/admin/src/api/Errors';
import {searchGuilds} from '@fluxer/admin/src/api/Guilds';
import {searchUsers} from '@fluxer/admin/src/api/Users';
import {ErrorAlert} from '@fluxer/admin/src/components/ErrorDisplay';
import {Layout} from '@fluxer/admin/src/components/Layout';
import {Card} from '@fluxer/admin/src/components/ui/Card';
import {PageHeader} from '@fluxer/admin/src/components/ui/Layout/PageHeader';
import {PageLayout} from '@fluxer/admin/src/components/ui/Layout/PageLayout';
import {ResourceLink} from '@fluxer/admin/src/components/ui/ResourceLink';
import {Heading, Text} from '@fluxer/admin/src/components/ui/Typography';
import type {Session} from '@fluxer/admin/src/types/App';
import type {AdminConfig as Config} from '@fluxer/admin/src/types/Config';
import {formatTimestamp} from '@fluxer/date_utils/src/DateFormatting';
import type {Flash} from '@fluxer/hono/src/Flash';
import type {AdminAuditLogResponseSchema} from '@fluxer/schema/src/domains/admin/AdminSchemas';
import type {GuildAdminResponse} from '@fluxer/schema/src/domains/admin/AdminGuildSchemas';
import type {UserAdminResponse} from '@fluxer/schema/src/domains/admin/AdminUserSchemas';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {Button} from '@fluxer/ui/src/components/Button';
import {EmptyState} from '@fluxer/ui/src/components/EmptyState';
import {formatDiscriminator, formatUserTag} from '@fluxer/ui/src/utils/FormatUser';
import type {FC, PropsWithChildren} from 'hono/jsx';
import type {z} from 'zod';

type AuditLog = z.infer<typeof AdminAuditLogResponseSchema>;

interface DashboardPageProps {
	config: Config;
	session: Session;
	currentAdmin: UserAdminResponse | undefined;
	flash: Flash | undefined;
	assetVersion: string;
	csrfToken: string;
	adminAcls: Array<string>;
}

function formatSnowflakeTimestamp(id: string): string {
	const timestamp = extractTimestamp(id);
	if (!Number.isFinite(timestamp)) {
		return 'Unknown';
	}

	return formatTimestamp(new Date(timestamp).toISOString(), 'en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function formatAuditAction(action: string): string {
	return action.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
}

function formatAuditTarget(log: AuditLog): string {
	if (log.target_type === 'guild') {
		return `Guild ${log.target_id}`;
	}
	if (log.target_type === 'user') {
		return `User ${log.target_id}`;
	}
	return `${log.target_type} ${log.target_id}`;
}

const StatCard: FC<{label: string; value: string; description: string}> = ({label, value, description}) => (
	<Card className="h-full">
		<div class="space-y-2">
			<Text size="sm" weight="semibold" color="muted" class="uppercase tracking-wide">
				{label}
			</Text>
			<Heading level={2}>{value}</Heading>
			<Text size="sm" color="muted">
				{description}
			</Text>
		</div>
	</Card>
);

const SectionCard: FC<PropsWithChildren<{title: string; href?: string; hrefLabel?: string}>> = ({
	title,
	href,
	hrefLabel,
	children,
}) => (
	<Card className="h-full">
		<div class="mb-4 flex items-center justify-between gap-4">
			<Heading level={3} size="lg">
				{title}
			</Heading>
			{href && hrefLabel ? (
				<Button variant="secondary" size="small" href={href}>
					{hrefLabel}
				</Button>
			) : null}
		</div>
		{children}
	</Card>
);

const RecentUsersList: FC<{config: Config; users: Array<UserAdminResponse>}> = ({config, users}) => {
	if (users.length === 0) {
		return <EmptyState title="No users found" />;
	}

	return (
		<div class="space-y-3">
			{users.map((user) => (
				<div
					key={user.id}
					class="flex items-start justify-between gap-3 border-neutral-200 border-b pb-3 last:border-b-0 last:pb-0"
				>
					<div class="min-w-0">
						<ResourceLink config={config} resourceType="user" resourceId={user.id} class="no-underline">
							<Text weight="semibold">{formatUserTag(user.username, user.discriminator)}</Text>
						</ResourceLink>
						<Text size="sm" color="muted" class="break-all">
							{user.email ?? `${user.username}#${formatDiscriminator(user.discriminator)}`}
						</Text>
					</div>
					<Text size="sm" color="muted">
						{formatSnowflakeTimestamp(user.id)}
					</Text>
				</div>
			))}
		</div>
	);
};

const RecentGuildsList: FC<{config: Config; guilds: Array<GuildAdminResponse>}> = ({config, guilds}) => {
	if (guilds.length === 0) {
		return <EmptyState title="No communities found" />;
	}

	return (
		<div class="space-y-3">
			{guilds.map((guild) => (
				<div
					key={guild.id}
					class="flex items-start justify-between gap-3 border-neutral-200 border-b pb-3 last:border-b-0 last:pb-0"
				>
					<div class="min-w-0">
						<ResourceLink config={config} resourceType="guild" resourceId={guild.id} class="no-underline">
							<Text weight="semibold">{guild.name}</Text>
						</ResourceLink>
						<Text size="sm" color="muted">
							{guild.member_count} members
						</Text>
					</div>
					<Text size="sm" color="muted">
						{formatSnowflakeTimestamp(guild.id)}
					</Text>
				</div>
			))}
		</div>
	);
};

const AuditLogList: FC<{logs: Array<AuditLog>}> = ({logs}) => {
	if (logs.length === 0) {
		return <EmptyState title="No audit log entries found" />;
	}

	return (
		<div class="space-y-3">
			{logs.map((log) => (
				<div key={log.log_id} class="border-neutral-200 border-b pb-3 last:border-b-0 last:pb-0">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<Text weight="semibold">{formatAuditAction(log.action)}</Text>
							<Text size="sm" color="muted" class="break-all">
								{formatAuditTarget(log)}
							</Text>
							{log.audit_log_reason ? (
								<Text size="sm" color="muted" class="mt-1 line-clamp-2">
									{log.audit_log_reason}
								</Text>
							) : null}
						</div>
						<Text size="sm" color="muted">
							{formatTimestamp(log.created_at, 'en-US', {
								month: 'short',
								day: 'numeric',
								hour: '2-digit',
								minute: '2-digit',
							})}
						</Text>
					</div>
				</div>
			))}
		</div>
	);
};

export async function DashboardPage({
	config,
	session,
	currentAdmin,
	flash,
	assetVersion,
	csrfToken,
	adminAcls,
}: DashboardPageProps) {
	const canViewUsers = hasPermission(adminAcls, AdminACLs.USER_LOOKUP);
	const canViewGuilds = hasPermission(adminAcls, AdminACLs.GUILD_LOOKUP);
	const canViewAuditLogs = hasPermission(adminAcls, AdminACLs.AUDIT_LOG_VIEW);

	let users: Array<UserAdminResponse> = [];
	let guilds: Array<GuildAdminResponse> = [];
	let logs: Array<AuditLog> = [];
	const errors: Array<string> = [];

	if (canViewUsers) {
		const result = await searchUsers(config, session, '', 0, 5);
		if (result.ok) {
			users = result.data.users;
		} else {
			errors.push(getErrorMessage(result.error));
		}
	}

	if (canViewGuilds) {
		const result = await searchGuilds(config, session, '', 5, 0);
		if (result.ok) {
			guilds = result.data.guilds;
		} else {
			errors.push(getErrorMessage(result.error));
		}
	}

	if (canViewAuditLogs) {
		const result = await searchAuditLogs(config, session, {
			query: undefined,
			admin_user_id: undefined,
			target_id: undefined,
			limit: 8,
			offset: 0,
		});
		if (result.ok) {
			logs = result.data.logs;
		} else {
			errors.push(getErrorMessage(result.error));
		}
	}

	return (
		<Layout
			csrfToken={csrfToken}
			title="Dashboard"
			activePage="dashboard"
			config={config}
			session={session}
			currentAdmin={currentAdmin}
			flash={flash}
			assetVersion={assetVersion}
		>
			<PageLayout maxWidth="7xl">
				<div class="space-y-6">
					<PageHeader
						title="Dashboard"
						actions={
							<Text size="sm" color="muted">
								Systemweite Uebersicht fuer Communities, Nutzer und Aktivitaet
							</Text>
						}
					/>

					{errors.map((error, index) => (
						<ErrorAlert key={`${error}-${index}`} error={error} />
					))}

					<div class="grid gap-4 md:grid-cols-3">
						{canViewUsers ? (
							<StatCard
								label="Nutzer"
								value={users.length.toString()}
								description="Neueste gefundene Accounts auf dieser Instanz"
							/>
						) : null}
						{canViewGuilds ? (
							<StatCard
								label="Communities"
								value={guilds.length.toString()}
								description="Neueste gefundene Communities auf dieser Instanz"
							/>
						) : null}
						{canViewAuditLogs ? (
							<StatCard
								label="Audit Log"
								value={logs.length.toString()}
								description="Letzte protokollierte Admin- und Systemereignisse"
							/>
						) : null}
					</div>

					<div class="grid gap-6 xl:grid-cols-3">
						{canViewUsers ? (
							<SectionCard title="Neue Nutzer" href={`${config.basePath}/users`} hrefLabel="Nutzer suchen">
								<RecentUsersList config={config} users={users} />
							</SectionCard>
						) : null}
						{canViewGuilds ? (
							<SectionCard
								title="Neue Communities"
								href={`${config.basePath}/guilds`}
								hrefLabel="Communities suchen"
							>
								<RecentGuildsList config={config} guilds={guilds} />
							</SectionCard>
						) : null}
						{canViewAuditLogs ? (
							<SectionCard title="Aktivitaetslog" href={`${config.basePath}/audit-logs`} hrefLabel="Audit Logs">
								<AuditLogList logs={logs} />
							</SectionCard>
						) : null}
					</div>
				</div>
			</PageLayout>
		</Layout>
	);
}
