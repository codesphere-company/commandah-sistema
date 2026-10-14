/* ============ MEMBERS (sócios) — tabelas relacionais em modo nuvem, blob em modo local ============ */
function isCloudMode(){ return storageApi && storageApi.mode==='Nuvem (Supabase)'; }
function memberFromRow(row, dependents, debtHistory){
  return {
    id: row.id, name: row.name, code: row.code||'', phone: row.phone||'', email: row.email||'',
    gender: row.gender||'', document: row.document||'', registry: row.registry||'',
    birthDate: row.birth_date||'', zip: row.zip||'', address: row.address||'',
    addressNumber: row.address_number||'', addressComplement: row.address_complement||'',
    district: row.district||'', city: row.city||'', uf: row.uf||'', reference: row.reference||'',
    ibge: row.ibge||'', tags: row.tags||[], notes: row.notes||'',
    points: Number(row.points)||0, pointsHistory: row.points_history||[],
    debt: Number(row.debt)||0, creditLimit: Number(row.credit_limit)||0,
    active: row.active!==false, archived: !!row.archived,
    archivedAt: row.archived_at||undefined, archivedBy: row.archived_by||undefined,
    latitude: row.latitude==null?undefined:row.latitude, longitude: row.longitude==null?undefined:row.longitude,
    geoStatus: row.geo_status||undefined, debtRelease: row.debt_release||null,
    marketingOptIn: !!row.marketing_opt_in, anonymizedAt: row.anonymized_at||null,
    dependents: dependents||[], debtHistory: debtHistory||[]
  };
}
function memberDependentFromRow(row){
  return { id: row.id, name: row.name, relationship: row.relationship||'', document: row.document||'', canOrder: row.can_order!==false };
}
function debtEntryFromRow(row){
  return { id: row.id, type: row.type, value: Number(row.value)||0, reason: row.reason||'', info: row.info||'',
    method: row.method||'', at: row.at, user: row.created_by||'', reversed: !!row.reversed, saleId: row.sale_id||null,
    reversedAt: row.reversed_at||undefined, reversedBy: row.reversed_by||undefined };
}
function memberFieldsToRow(data){
  return {
    name: data.name, code: data.code||null, phone: data.phone||null, email: data.email||null,
    gender: data.gender||null, document: data.document||null, registry: data.registry||null,
    birth_date: data.birthDate||null, zip: data.zip||null, address: data.address||null,
    address_number: data.addressNumber||null, address_complement: data.addressComplement||null,
    district: data.district||null, city: data.city||null, uf: data.uf||null,
    reference: data.reference||null, ibge: data.ibge||null, tags: data.tags||[], notes: data.notes||null,
    ...('marketingOptIn' in data ? { marketing_opt_in: !!data.marketingOptIn } : {}),
    updated_at: new Date().toISOString()
  };
}
function recalcMemberDebtLocal(member){
  const debt = (member.debtHistory||[]).reduce((sum,x)=>{
    if(x.reversed) return sum;
    return sum + (x.type==='debt'?Number(x.value)||0:-(Number(x.value)||0));
  },0);
  member.debt = debt;
}
async function fetchAllRows(makeQuery){
  const out = [];
  for(let from = 0; ; from += 1000){
    const { data, error } = await makeQuery().range(from, from + 999);
    if(error) throw error;
    out.push(...(data||[]));
    if(!data || data.length < 1000) return out;
  }
}
const MembersStore = {
  async load(){
    if(isCloudMode()){
      const tenantId = storageApi.tenantId;
      // O Supabase devolve no máximo 1000 linhas por consulta: o clube tem mais de 1000 sócios e
      // o extrato de fiado passa disso. Sem paginar, sócio e lançamento ficavam de fora (e o
      // saldo recalculado no aparelho saía errado).
      const [rows, deps, entries] = await Promise.all([
        fetchAllRows(()=>supabaseClient.from('members').select('*').eq('tenant_id', tenantId).order('id')),
        fetchAllRows(()=>supabaseClient.from('member_dependents').select('*').eq('tenant_id', tenantId).order('id')),
        fetchAllRows(()=>supabaseClient.from('member_debt_entries').select('*').eq('tenant_id', tenantId).order('at',{ascending:false}).order('id'))
      ]);
      const depsByMember = {}, entriesByMember = {};
      (deps||[]).forEach(d=>{ (depsByMember[d.member_id] = depsByMember[d.member_id]||[]).push(memberDependentFromRow(d)); });
      (entries||[]).forEach(e=>{ (entriesByMember[e.member_id] = entriesByMember[e.member_id]||[]).push(debtEntryFromRow(e)); });
      return (rows||[]).map(r=>memberFromRow(r, depsByMember[r.id], entriesByMember[r.id]));
    }
    const r = await storageApi.get(STORE.members);
    return r ? JSON.parse(r.value) : [];
  },
  // Relê um sócio inteiro (cadastro, dependentes e extrato) do servidor. Usado antes de checar o
  // bloqueio por fiado: o fiado pode ter sido lançado em outro aparelho.
  async refreshOne(id){
    if(!isCloudMode()) return state.members.find(x=>x.id===id)||null;
    const [{data:row,error:e1},{data:deps,error:e2},entries] = await Promise.all([
      supabaseClient.from('members').select('*').eq('id', id).maybeSingle(),
      supabaseClient.from('member_dependents').select('*').eq('member_id', id),
      fetchAllRows(()=>supabaseClient.from('member_debt_entries').select('*').eq('member_id', id).order('at',{ascending:false}).order('id'))
    ]);
    if(e1) throw e1; if(e2) throw e2;
    if(!row) return null;
    const fresh = memberFromRow(row, (deps||[]).map(memberDependentFromRow), (entries||[]).map(debtEntryFromRow));
    const cur = state.members.find(x=>x.id===id);
    if(cur){ Object.assign(cur, fresh); return cur; }
    state.members.push(fresh); return fresh;
  },
  // A cada 30 s: acerta a dívida e a liberação dos sócios que mudaram em outro aparelho.
  async refreshDebts(){
    if(!isCloudMode()) return false;
    const rows = await fetchAllRows(()=>supabaseClient.from('members').select('id,debt,debt_release').eq('tenant_id', storageApi.tenantId).or('debt.neq.0,debt_release.not.is.null').order('id'));
    const seen = new Set(), changed = [];
    rows.forEach(r=>{ seen.add(r.id); const m=state.members.find(x=>x.id===r.id); if(!m) return; if(Math.abs((Number(r.debt)||0)-(Number(m.debt)||0))>0.009 || JSON.stringify(r.debt_release||null)!==JSON.stringify(m.debtRelease||null)) changed.push(m.id); });
    state.members.forEach(m=>{ if(!seen.has(m.id) && (Math.abs(Number(m.debt)||0)>0.009 || m.debtRelease)) changed.push(m.id); });
    for(const id of changed.slice(0,20)){ try{ await this.refreshOne(id); }catch(e){} }
    return changed.length>0;
  },
  async create(data){
    if(isCloudMode()){
      const id = uid();
      const row = { id, tenant_id: storageApi.tenantId, ...memberFieldsToRow(data), credit_limit: Number(data.creditLimit)||0, created_at: new Date().toISOString() };
      const { error } = await supabaseClient.from('members').insert(row);
      if(error) throw error;
      const member = memberFromRow({...row, debt:0, points:0, points_history:[], active:true, archived:false}, [], []);
      state.members.push(member);
      return member;
    }
    const member = { id: uid(), debt:0, ...data };
    state.members.push(member);
    await save('members');
    return member;
  },
  async update(id, data){
    const member = state.members.find(x=>x.id===id);
    if(!member) return null;
    if(isCloudMode()){
      const row = memberFieldsToRow(data);
      if('creditLimit' in data) row.credit_limit = Number(data.creditLimit)||0;
      const { error } = await supabaseClient.from('members').update(row).eq('id', id);
      if(error) throw error;
    }
    Object.assign(member, data);
    if(!isCloudMode()) await save('members');
    return member;
  },
  async saveDependents(memberId, dependents){
    const member = state.members.find(x=>x.id===memberId);
    if(!member) return;
    if(isCloudMode()){
      const { error: delErr } = await supabaseClient.from('member_dependents').delete().eq('member_id', memberId);
      if(delErr) throw delErr;
      if(dependents.length){
        const rows = dependents.map(d=>({
          id: d.id||uid(), tenant_id: storageApi.tenantId, member_id: memberId,
          name: d.name, relationship: d.relationship||null, document: d.document||null,
          can_order: d.canOrder!==false
        }));
        const { error: insErr } = await supabaseClient.from('member_dependents').insert(rows);
        if(insErr) throw insErr;
        member.dependents = rows.map(memberDependentFromRow);
      } else {
        member.dependents = [];
      }
    } else {
      member.dependents = dependents;
      await save('members');
    }
  },
  async archive(id, archivedBy){
    const member = state.members.find(x=>x.id===id);
    if(!member) return;
    const archivedAt = new Date().toISOString();
    if(isCloudMode()){
      const { error } = await supabaseClient.from('members').update({ archived:true, archived_at:archivedAt, archived_by:archivedBy, updated_at:archivedAt }).eq('id', id);
      if(error) throw error;
    }
    member.archived = true; member.archivedAt = archivedAt; member.archivedBy = archivedBy;
    if(!isCloudMode()) await save('members');
  },
  async restore(id){
    const member = state.members.find(x=>x.id===id);
    if(!member) return;
    if(isCloudMode()){
      const { error } = await supabaseClient.from('members').update({ archived:false, archived_at:null, archived_by:null, updated_at:new Date().toISOString() }).eq('id', id);
      if(error) throw error;
    }
    member.archived = false; delete member.archivedAt; delete member.archivedBy;
    if(!isCloudMode()) await save('members');
  },
  async setArchived(id, archived, archivedBy){
    return archived ? this.archive(id, archivedBy) : this.restore(id);
  },
  async recordDebtEntry(memberId, type, value, extra){
    extra = extra||{};
    const member = state.members.find(x=>x.id===memberId);
    if(!member) return;
    const at = extra.at || new Date().toISOString();
    const createdBy = extra.createdBy || (currentUser&&currentUser.name) || '';
    if(isCloudMode()){
      const row = {
        id: extra.id||uid(), tenant_id: storageApi.tenantId, member_id: memberId, type, value: Number(value),
        reason: extra.reason||null, info: extra.info||null, method: extra.method||null,
        sale_id: extra.saleId||null, created_by: createdBy, at
      };
      const { error } = await supabaseClient.from('member_debt_entries').insert(row);
      // 23505 = o mesmo id já gravou numa tentativa anterior cuja resposta se perdeu.
      if(error && error.code!=='23505') throw error;
      member.debtHistory = member.debtHistory||[];
      if(!member.debtHistory.some(x=>x.id===row.id)) member.debtHistory.unshift(debtEntryFromRow(row));
      recalcMemberDebtLocal(member);
      return row.id;
    }
    const id = extra.id||uid();
    member.debtHistory = Array.isArray(member.debtHistory)?member.debtHistory:[];
    member.debtHistory.unshift({ id, type, value:Number(value), reason:extra.reason||'', info:extra.info||'', method:extra.method||'', at, user:createdBy, reversed:false, saleId:extra.saleId||null });
    await save('members');
    recalcMemberDebtLocal(member);
    return id;
  },
  async reverseDebtEntry(memberId, entryId, reversedBy){
    const member = state.members.find(x=>x.id===memberId);
    if(!member) return;
    const entry = (member.debtHistory||[]).find(x=>x.id===entryId);
    if(!entry || entry.reversed) return;
    const reversedAt = new Date().toISOString();
    if(isCloudMode()){
      const { error } = await supabaseClient.from('member_debt_entries').update({ reversed:true, reversed_at:reversedAt, reversed_by:reversedBy }).eq('id', entryId);
      if(error) throw error;
    }
    entry.reversed = true; entry.reversedAt = reversedAt; entry.reversedBy = reversedBy;
    if(!isCloudMode()) await save('members');
    recalcMemberDebtLocal(member);
  },
  async bulkImport(newMembers){
    if(isCloudMode()){
      const now = new Date().toISOString();
      const rows = newMembers.map(data=>({ id: data.id||uid(), tenant_id: storageApi.tenantId, ...memberFieldsToRow(data), created_at: now }));
      for(let i=0;i<rows.length;i+=500){
        const { error } = await supabaseClient.from('members').insert(rows.slice(i,i+500));
        if(error) throw error;
      }
      const debtRows = [];
      newMembers.forEach((data,i)=>{
        const value = Number(data.debt)||0;
        if(value>0) debtRows.push({ id: uid(), tenant_id: storageApi.tenantId, member_id: rows[i].id, type:'debt', value, reason:'Saldo inicial (importação de planilha)', at: now });
      });
      for(let i=0;i<debtRows.length;i+=500){
        const { error } = await supabaseClient.from('member_debt_entries').insert(debtRows.slice(i,i+500));
        if(error) throw error;
      }
      state.members = await this.load();
    } else {
      newMembers.forEach(data=>state.members.push({ id: uid(), debt:0, tags:[], ...data }));
      await save('members');
    }
  },
  async setCode(id, code){
    return this.update(id, { code });
  },
  async removeTagEverywhere(tag){
    const affected = state.members.filter(m=>(m.tags||[]).includes(tag));
    if(isCloudMode()){
      await Promise.all(affected.map(m=>{
        const newTags = (m.tags||[]).filter(x=>x!==tag);
        return supabaseClient.from('members').update({ tags:newTags, updated_at:new Date().toISOString() }).eq('id', m.id);
      }));
    }
    affected.forEach(m=>{ m.tags = (m.tags||[]).filter(x=>x!==tag); });
    if(!isCloudMode()) await save('members');
  },
  async saveGeo(memberId, geo){
    const member = state.members.find(x=>x.id===memberId);
    if(!member) return;
    if(isCloudMode()){
      const { error } = await supabaseClient.from('members').update({ latitude:geo.latitude, longitude:geo.longitude, geo_status:geo.geoStatus, updated_at:new Date().toISOString() }).eq('id', memberId);
      if(error) throw error;
    }
    Object.assign(member, geo);
    if(!isCloudMode()) await save('members');
  },
  async bulkSetGeoStatus(members, geoStatus){
    if(isCloudMode()){
      await Promise.all(members.map(m=>supabaseClient.from('members').update({ geo_status:geoStatus, updated_at:new Date().toISOString() }).eq('id', m.id)));
    }
    members.forEach(m=>{ m.geoStatus = geoStatus; });
    if(!isCloudMode()) await save('members');
  },
  async setPoints(memberId, points, pointsHistory){
    const member = state.members.find(x=>x.id===memberId);
    if(!member) return;
    if(isCloudMode()){
      const { error } = await supabaseClient.from('members').update({ points, points_history:pointsHistory, updated_at:new Date().toISOString() }).eq('id', memberId);
      if(error) throw error;
    }
    member.points = points; member.pointsHistory = pointsHistory;
    if(!isCloudMode()) await save('members');
  }
};

