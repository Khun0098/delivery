const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/**
 * Calcula se o estabelecimento está aberto agora.
 * - estabelecimento suspenso ou pausado manualmente => fechado
 * - sem horários cadastrados => segue apenas a chave manual
 * - horários com virada de dia (ex.: 18:00–02:00) são suportados
 */
export function statusFuncionamento(est, horarios, tzOffsetHours = -3) {
  if (!est.ativo) return { aberto: false, motivo: 'inativo', abre_as: null, abre_hoje: false };
  if (!est.aberto_manual) return { aberto: false, motivo: 'pausado', abre_as: null, abre_hoje: false };
  if (!horarios.length) return { aberto: true, motivo: null, abre_as: null, abre_hoje: false };

  const local = new Date(Date.now() + tzOffsetHours * 3600e3);
  const dia = local.getUTCDay();
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();

  for (const h of horarios) {
    const a = toMin(h.abre), f = toMin(h.fecha);
    if (h.dia_semana === dia && (f > a ? min >= a && min < f : min >= a)) return { aberto: true, motivo: null, abre_as: null, abre_hoje: false };
    if (h.dia_semana === (dia + 6) % 7 && f <= a && min < f) return { aberto: true, motivo: null, abre_as: null, abre_hoje: false };
  }

  const hoje = horarios.filter((h) => h.dia_semana === dia && toMin(h.abre) > min).sort((x, y) => toMin(x.abre) - toMin(y.abre));
  if (hoje.length) return { aberto: false, motivo: 'fechado', abre_as: hoje[0].abre, abre_hoje: true };
  for (let i = 1; i <= 7; i++) {
    const d = (dia + i) % 7;
    const hs = horarios.filter((h) => h.dia_semana === d).sort((x, y) => toMin(x.abre) - toMin(y.abre));
    if (hs.length) return { aberto: false, motivo: 'fechado', abre_as: hs[0].abre, abre_hoje: false, abre_dia: d };
  }
  return { aberto: false, motivo: 'fechado', abre_as: null, abre_hoje: false };
}

export function getHorarios(db, estId) {
  return db.prepare('SELECT dia_semana, abre, fecha FROM horarios WHERE estabelecimento_id = ? ORDER BY dia_semana, abre').all(estId);
}
