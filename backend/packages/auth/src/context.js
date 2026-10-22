export const tenantOf = (a) => ('tenantId' in a ? a.tenantId : null);
export const freezeActor = (a) => Object.freeze({ ...a });
/** actor_type / actor_id as written to ticket_events and audit_log. */
export function actorRef(a) {
    switch (a.kind) {
        case 'user':
            return { type: 'user', id: a.userId };
        case 'support':
            return { type: 'support', id: a.platformUserId };
        case 'staff_device':
            return { type: 'staff_device', id: a.deviceId };
        case 'api_key':
            return { type: 'api_key', id: a.apiKeyId };
        case 'platform':
            return { type: 'platform_user', id: a.platformUserId };
        default:
            return { type: 'system', id: null };
    }
}
