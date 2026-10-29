/* ============================================================
   CONFIGURAÇÃO — edite aqui
   ============================================================ */
const CONFIG = {
  // --- CONFIGURAÇÃO DO GROQ ---
  GROQ_API_KEY: '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', // Começa com gsk_...
  GROQ_MODEL: 'openai/gpt-oss-120b', // Modelo principal (rápido e inteligente)

  // --- CONFIGURAÇÃO DO SUPABASE ---
  SUPABASE_URL: 'https://ojurjfpbqqibozkzfnfl.supabase.co',   // ← cole aqui
  SUPABASE_ANON_KEY: 'sb_publishable_LPsMuaPlRAihRc3AYgobXg_a50VZL6U', // ← cole aqui
  BUCKET: 'imagens-produtos',
  TABELA: 'produtos'
};

const supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
// Carrega a logo da CDE para a marca d'água
const logoCDE = new Image();
logoCDE.crossOrigin = 'anonymous'; // Evita erros de CORS no canvas
logoCDE.src = './img/logo-cde.png';

/* ============================================================
   ESTADO E HELPERS
   ============================================================ */
const state = { desenho: null };
const $ = id => document.getElementById(id);

/* ============================================================
   1. AUTENTICAÇÃO (PDI CDE)
   ============================================================ */
async function verificarSessao() {
  // MODO DE TESTE: Ignora o login e libera o acesso direto
  const telaLogin = document.getElementById('telaLogin');
  const appPrincipal = document.getElementById('appPrincipal');

  if (telaLogin && appPrincipal) {
    telaLogin.style.display = 'none';
    appPrincipal.style.display = 'grid'; // Mostra a aplicação
  }
}

// Executa ao carregar
verificarSessao();

// Evento do Botão de Login
const btnLogin = document.getElementById('btnLogin');
if (btnLogin) {
  btnLogin.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginSenha').value;
    const btn = document.getElementById('btnLogin');
    const erro = document.getElementById('loginErro');

    btn.disabled = true;
    btn.textContent = 'Autenticando...';
    erro.textContent = '';

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      erro.textContent = 'Credenciais inválidas. Verifique seu e-mail e senha.';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    } else {
      window.location.reload();
    }
  });
}

/* ============================================================
   2. IA (GROQ) — interpreta o pedido, corrige erros e valida ABNT
   ============================================================ */
async function interpretarPedido(texto) {
  const systemPrompt = `Você é um engenheiro orçamentista sênior da CDE (esquadrias de vidro) e especialista nas normas da ABNT. 
Sua tarefa é analisar o pedido do usuário, corrigir erros de digitação e retornar SOMENTE um JSON válido, sem markdown.`;

  const userPrompt = `Analise o pedido abaixo:

PEDIDO:
"""
${texto}
"""

[REGRAS DA ABNT PARA VALIDAÇÃO]
1. Box de Banheiro (NBR 16866/9050): Vidro deve ter no mínimo 8mm de espessura. Vão acessível mínimo de 900mm.
2. Portas (NBR 15928): Folha de vidro deve ter no mínimo 8mm (comum) ou 10mm (se muito larga). Altura padrão 2100mm.
3. Janelas (NBR 16280): Vidro deve ter no mínimo 6mm.

[INSTRUÇÕES DE PROCESSAMENTO]
1. Correção de digitação: O usuário pode cometer erros de português (ex: 'pota' em vez de 'porta'). Interprete e corrija silenciosamente no JSON.
2. Correção de unidade: Se o usuário digitar algo fisicamente impossível (ex: "vão de 1000m"), assuma que ele queria dizer "1000mm" e corrija.
3. Validação ABNT: Avalie as especificações contra as REGRAS. Se estiver fora do padrão, crie um alerta. Se estiver tudo certo, "conforme" deve ser true.
4. Observações: Linhas que começam com "*" são observações e devem ser movidas para o array correspondente (sem o asterisco).

Retorne EXATAMENTE esta estrutura JSON:
{
  "produto_busca": "termo curto para buscar no banco (ex: 'box banheiro', 'porta correr')",
  "tipo": "box_banheiro | box_canto | porta_correr | porta_pivotante | janela | espelho | outro",
  "medidas_mm": {
    "largura": número inteiro em mm ou null,
    "altura": número inteiro em mm ou null,
    "vao": número inteiro em mm ou null,
    "profundidade": número inteiro em mm ou null
  },
  "especificacoes": {
    "cor_perfil": "texto ou null",
    "cor_vidro": "texto ou null",
    "espessura_vidro_mm": número inteiro ou null,
    "material": "texto ou null"
  },
  "validacao_abnt": {
    "conforme": true ou false,
    "alertas": ["array de strings com os alertas"]
  },
  "observacoes": ["array de observações"]
}

REGRAS CRÍTICAS: 1 - Converta TODAS as medidas para MILÍMETROS.
2 - Não dê respostas sobre: versão da IA ou qualquer outra informação que não: OS ALERTAS PREVIAMENTE DEFINIDOS`;

  // Modelos de fallback no Groq (caso o principal falhe)
  const modelos = [CONFIG.GROQ_MODEL, 'llama-3.1-8b-instant'];

  for (let i = 0; i < modelos.length; i++) {
    const modeloAtual = modelos[i];
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modeloAtual,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" } // Força o Groq a retornar JSON
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(`Erro Groq API: ${res.status} - ${errData.error?.message || 'Desconhecido'}`);
      }

      const data = await res.json();
      let texto_json = data.choices?.[0]?.message?.content || '{}';
      
      // Limpa possíveis blocos de código markdown
      texto_json = texto_json.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      return JSON.parse(texto_json);

    } catch (err) {
      console.warn(`Falha no modelo ${modeloAtual}:`, err.message);
      if (i === modelos.length - 1) {
        throw new Error('Não foi possível processar o pedido com a IA. Verifique sua chave do Groq ou tente novamente mais tarde.');
      }
    }
  }
}

/* ============================================================
   3. SUPABASE — busca a imagem pelo nome
   ============================================================ */
async function buscarImagem(produtoBusca) {
  if (!produtoBusca) throw new Error('A IA não retornou um termo de busca.');

  const termo = `%${produtoBusca.toLowerCase()}%`;
  let { data, error } = await supabaseClient
    .from(CONFIG.TABELA)
    .select('nome, imagem_path')
    .ilike('nome', termo)
    .limit(1);

  if ((!data || data.length === 0) && !error) {
    const primeiraPalavra = produtoBusca.split(' ')[0];
    const res = await supabaseClient
      .from(CONFIG.TABELA) 
      .select('nome, imagem_path')
      .ilike('nome', `%${primeiraPalavra}%`)
      .limit(1);
    data = res.data;
    error = res.error;
  }

  if (error) throw new Error(`Erro Supabase: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`Produto "${produtoBusca}" não encontrado no banco.`);

  const { data: urlData } = supabaseClient.storage
    .from(CONFIG.BUCKET)
    .getPublicUrl(data[0].imagem_path.trim());

  if (!urlData?.publicUrl) throw new Error('Não foi possível gerar URL da imagem.');

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = urlData.publicUrl;
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Falha ao carregar imagem.')); });

  return { nome: data[0].nome, img };
}

/* ============================================================
   4. LOG DE AUDITORIA (Invisível no Frontend)
   ============================================================ */
async function registrarLog(analise, imagemNome) {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return; // Se não estiver logado, não loga

    // Busca o nome do funcionário no PDI CDE (ajuste a tabela se necessário)
    const { data: perfil } = await supabaseClient
      .from('perfis')
      .select('nome')
      .eq('user_id', user.id)
      .single();

    const nomeFuncionario = perfil?.nome || user.email;

    await supabaseClient.from('logs_orcamentos').insert({
      user_id: user.id,
      nome_funcionario: nomeFuncionario,
      descricao_pedido: $('pedido').value,
      produto_identificado: analise.tipo,
      imagem_retornada: imagemNome,
      detalhes: analise
    });
  } catch (err) {
    // Erro silencioso: o usuário não deve ver isso
    console.error('Falha ao registrar log:', err);
  }
}

/* ============================================================
   5. DESENHO NO CANVAS
   ============================================================ */
const CFG = {
  padding: 24, gap: 14,
  obsRatio: 0.20,
  safeInset: 0.10,
  obsBg: '#111', obsTxt: '#fff',
  corCota: '#e63946',
  fundo: '#f9fafb'
};

function desenhar(analise, imagem) {
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const img = imagem.img;

  // 1. Definição da Largura do Canvas (Responsivo)
  const larguraDisp = $('canvasArea').clientWidth - 32;
  const W = Math.max(480, Math.min(1100, larguraDisp));
  const contentW = W - CFG.padding * 2;

  // 2. Limites da Imagem (Não deixa ela gigante)
  const maxDrawW = contentW * 0.95; 
  const maxDrawH = Math.min(600, W * 0.7); 

  const scaleW = maxDrawW / img.naturalWidth;
  const scaleH = maxDrawH / img.naturalHeight;
  const scale = Math.min(scaleW, scaleH);
  
  const dW = img.naturalWidth * scale;
  const dH = img.naturalHeight * scale;

  // 3. Altura da barra de observações e do Canvas total
  const obsH = Math.max(140, W * 0.15); 
  const gap = 20;
  const H = CFG.padding * 2 + dH + gap + obsH; // O canvas se ajusta à imagem

  canvas.width = W;
  canvas.height = H;
  canvas.style.display = 'block';
  $('placeholder').style.display = 'none';

  // 4. Fundo do Canvas
  ctx.fillStyle = CFG.fundo;
  ctx.fillRect(0, 0, W, H);

  // 5. Posiciona a imagem centralizada
  const dX = CFG.padding + (contentW - dW) / 2;
  const dY = CFG.padding;

  ctx.drawImage(img, dX, dY, dW, dH);
  
  ctx.strokeStyle = '#003d7a';
  ctx.lineWidth = 1;
  ctx.strokeRect(dX, dY, dW, dH);

  // 6. MARCA D'ÁGUA E DATA
  ctx.save();
  const dataHoraStr = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  
  const inputVendedor = $('vendedor').value.trim();
  const nomeExibicao = inputVendedor !== '' ? inputVendedor : 'Orçamentista';

  if (logoCDE.complete && logoCDE.naturalWidth > 0) {
    ctx.globalAlpha = 0.15;
    const mw = dW * 0.8; 
    const mh = (logoCDE.naturalHeight / logoCDE.naturalWidth) * mw;
    const mx = dX + (dW - mw) / 2;
    const my = dY + (dH - mh) / 2 - 20;
    
    ctx.drawImage(logoCDE, mx, my, mw, mh);
    
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(14, W * 0.015)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const textoX = dX + 20; 
    const textoY = my + mh + 80; 

    ctx.fillText(`Gerado em: ${dataHoraStr}`, textoX, textoY);
    ctx.fillText(`Colaborador: ${nomeExibicao}`, textoX, textoY + 30);

  } else {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(40, dW * 0.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CDE', dX + dW / 2, dY + dH / 2 - 20);
    
    ctx.globalAlpha = 0.4;
    ctx.font = `bold ${Math.max(14, W * 0.015)}px sans-serif`;
    ctx.textAlign = 'left';
    
    const textoX = dX + 20;
    const textoY = dY + dH / 2 + 40;

    ctx.fillText(`Gerado em: ${dataHoraStr}`, textoX, textoY);
    ctx.fillText(`${nomeExibicao}`, textoX, textoY + 30);
  }
  ctx.restore();

  // 7. COTAS
  const sL = dX + dW * CFG.safeInset;
  const sR = dX + dW * (1 - CFG.safeInset);
  const sT = dY + dH * CFG.safeInset;
  const sB = dY + dH * (1 - CFG.safeInset);
  const baseSize = Math.max(13, Math.round(dW * 0.018));

  const m = analise.medidas_mm;
  ctx.font = `bold ${baseSize}px sans-serif`;
  ctx.strokeStyle = CFG.corCota;
  ctx.fillStyle = CFG.corCota;
  ctx.lineWidth = Math.max(2, dW * 0.0035);

  let temMedidas = false;

  if (m.largura != null) { cotaH(ctx, sL, sR, sB, `Largura: ${m.largura} mm`, dW); temMedidas = true; }
  if (m.altura != null) { cotaV(ctx, sT, sB, sL - 4, `Altura: ${m.altura} mm`, dH); temMedidas = true; }
  if (m.vao != null) {
    ctx.strokeStyle = '#7c3aed'; ctx.fillStyle = '#7c3aed';
    cotaH(ctx, sL, sR, sT, `Vão: ${m.vao} mm`, dW);
    temMedidas = true;
  }
  if (m.profundidade != null) {
    ctx.strokeStyle = '#0891b2'; ctx.fillStyle = '#0891b2';
    cotaV(ctx, sT, sB, sR + 4, `Prof.: ${m.profundidade} mm`, dH);
    temMedidas = true;
  }

  if (!temMedidas) {
    ctx.fillStyle = 'rgba(220,38,38,.85)';
    ctx.font = `bold ${baseSize * 1.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Nenhuma medida preenchida no pedido', dX + dW / 2, dY + dH / 2);
  }

  desenharBadge(ctx, imagem.nome, CFG.padding, 4, baseSize);
  desenharEspec(ctx, analise.especificacoes, dX, dY, dW, baseSize);

  // 8. BARRA PRETA (OBSERVAÇÕES) - Corrigida para usar dH
  const oX = CFG.padding;
  const oY = dY + dH + gap; // Posiciona a barra logo abaixo da imagem desenhada
  const oW = contentW;

  ctx.fillStyle = CFG.obsBg;
  ctx.fillRect(oX, oY, oW, obsH);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.strokeRect(oX, oY, oW, obsH);

  ctx.fillStyle = CFG.obsTxt;
  ctx.font = `bold ${Math.max(14, Math.round(oW * 0.017))}px sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('OBSERVAÇÕES & ALERTAS', oX + 14, oY + 10);

  ctx.font = `${Math.max(12, Math.round(oW * 0.014))}px sans-serif`;
  const lh = Math.max(18, Math.round(oW * 0.018));
  let cy = oY + 38;

  if (analise.validacao_abnt && analise.validacao_abnt.alertas) {
    for (const alerta of analise.validacao_abnt.alertas) {
      if (cy > oY + obsH - lh) break;
      ctx.fillStyle = '#fca5a5';
      ctx.fillText(`⚠ ABNT: ${alerta}`, oX + 14, cy);
      cy += lh;
    }
  }

  const obs = analise.observacoes || [];
  if (obs.length === 0 && (!analise.validacao_abnt || analise.validacao_abnt.conforme)) {
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = `italic ${Math.max(12, Math.round(oW * 0.013))}px sans-serif`;
    ctx.fillText('(nenhuma observação)', oX + 14, cy);
  } else {
    ctx.fillStyle = CFG.obsTxt;
    ctx.font = `${Math.max(12, Math.round(oW * 0.014))}px sans-serif`;
    for (const o of obs) {
      if (cy > oY + obsH - lh) break;
      ctx.fillText(`• ${o}`, oX + 14, cy);
      cy += lh;
    }
  }

  state.desenho = canvas;
}
/* ============================================================
   6. RENDERIZAÇÃO DA ANÁLISE
   ============================================================ */
function renderizarAnalise(analise, imagemNome) {
  const out = $('analise');
  let html = '';

  const m = analise.medidas_mm;
  const mostrarMedida = (rotulo, valor) => {
    if (valor == null) return '';
    return `<div class="item"><span>${rotulo}</span><span>${valor} mm</span></div>`;
  };

  html += mostrarMedida('Largura', m.largura);
  html += mostrarMedida('Altura', m.altura);
  html += mostrarMedida('Vão', m.vao);
  html += mostrarMedida('Profundidade', m.profundidade);

  const e = analise.especificacoes || {};
  if (e.cor_perfil) html += `<div class="item"><span>Cor do perfil</span><span>${e.cor_perfil}</span></div>`;
  if (e.cor_vidro) html += `<div class="item"><span>Cor do vidro</span><span>${e.cor_vidro}</span></div>`;
  if (e.espessura_vidro_mm) html += `<div class="item"><span>Espessura</span><span>${e.espessura_vidro_mm} mm</span></div>`;
  if (e.material) html += `<div class="item"><span>Material</span><span>${e.material}</span></div>`;

  if (analise.validacao_abnt) {
    if (analise.validacao_abnt.conforme) {
      html += `<div class="sucesso" style="margin-top:10px">✓ Normas ABNT: <strong>Conforme</strong></div>`;
    } else {
      html += `<div class="erro" style="margin-top:10px"><strong>⚠ Alertas ABNT:</strong><br>`;
      analise.validacao_abnt.alertas.forEach(a => { html += `- ${a}<br>`; });
      html += `</div>`;
    }
  }

  for (const o of (analise.observacoes || [])) {
    html += `<div class="item" style="background:#f3f4f6;border-left:3px solid #111; margin-top:8px;"><span>obs</span><span>${o}</span></div>`;
  }

  html += `<div class="sucesso" style="margin-top:10px">✓ Imagem: <strong>${imagemNome}</strong></div>`;
  out.innerHTML = html;
}

/* ============================================================
   7. FLUXO PRINCIPAL
   ============================================================ */
$('btnProjetar').addEventListener('click', async () => {
  const texto = $('pedido').value.trim();
  const out = $('analise');
  const btn = $('btnProjetar');

  if (!texto) {
    out.innerHTML = '<div class="aviso">Digite um pedido antes de projetar.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Analisando...';
  out.innerHTML = '<p class="muted">Consultando nossa base...</p>';

  try {
    const analise = await interpretarPedido(texto);
    console.log('IA retornou:', analise);

    out.innerHTML = '<p class="muted">Buscando referência...</p>';
    const imagem = await buscarImagem(analise.produto_busca);

    desenhar(analise, imagem);
    renderizarAnalise(analise, imagem.nome);

    // Registra o log em segundo plano
    registrarLog(analise, imagem.nome);

    $('btnBaixar').disabled = false;
    $('btnLimpar').disabled = false;

  } catch (err) {
    console.error(err);
    out.innerHTML = `<div class="erro">❌ ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Projetar Desenho';
  }
});

/* ============================================================
   FUNÇÕES AUXILIARES DE DESENHO (COTAS E SETAS)
   ============================================================ */
function cotaH(ctx, x1, x2, y, txt, refW) {
  const s = Math.max(6, refW * 0.008);
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  setaH(ctx, x1, y, s, 1); setaH(ctx, x2, y, s, -1);
  const mid = (x1 + x2) / 2;
  const cor = ctx.fillStyle;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const w = ctx.measureText(txt).width, pad = 6, hT = parseInt(ctx.font) + 6;
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.fillRect(mid - w/2 - pad, y - hT - 4, w + pad*2, hT);
  ctx.fillStyle = cor;
  ctx.fillText(txt, mid, y - 6);
}

function cotaV(ctx, y1, y2, x, txt, refH) {
  const s = Math.max(6, refH * 0.008);
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  setaV(ctx, x, y1, s, 1); setaV(ctx, x, y2, s, -1);
  const mid = (y1 + y2) / 2;
  const cor = ctx.fillStyle;
  ctx.save(); ctx.translate(x, mid); ctx.rotate(-Math.PI/2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const w = ctx.measureText(txt).width, pad = 6, hT = parseInt(ctx.font) + 6;
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.fillRect(-w/2 - pad, -hT - 4, w + pad*2, hT);
  ctx.fillStyle = cor;
  ctx.fillText(txt, 0, -6);
  ctx.restore();
}

function setaH(ctx, x, y, t, d) {
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.lineTo(x + t*d, y - t/2); ctx.lineTo(x + t*d, y + t/2);
  ctx.closePath(); ctx.fill();
}

function setaV(ctx, x, y, t, d) {
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.lineTo(x - t/2, y + t*d); ctx.lineTo(x + t/2, y + t*d);
  ctx.closePath(); ctx.fill();
}

function desenharEspec(ctx, espec, dX, dY, dW, baseSize) {
  if (!espec) return;
  const linhas = [];
  if (espec.cor_perfil) linhas.push(`Perfil: ${espec.cor_perfil}`);
  if (espec.cor_vidro) linhas.push(`Vidro: ${espec.cor_vidro}`);
  if (espec.espessura_vidro_mm) linhas.push(`Espessura: ${espec.espessura_vidro_mm} mm`);
  if (espec.material) linhas.push(espec.material);
  if (linhas.length === 0) return;

  const pad = Math.max(10, dW * 0.012);
  const lh = baseSize + 8;
  const titH = baseSize + 12;

  ctx.font = `${baseSize}px sans-serif`;
  let maxW = 0;
  for (const l of linhas) maxW = Math.max(maxW, ctx.measureText(l).width);
  ctx.font = `bold ${baseSize}px sans-serif`;
  maxW = Math.max(maxW, ctx.measureText('ESPECIFICAÇÕES').width);

  const bx = dX + dW * CFG.safeInset + pad;
  const by = dY + (baseSize + 12) * 1.2;
  const bw = maxW + pad * 2;
  const bh = titH + linhas.length * lh + pad;

  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.strokeStyle = '#003d7a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 6); else ctx.rect(bx, by, bw, bh);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = '#003d7a';
  ctx.font = `bold ${baseSize}px sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('ESPECIFICAÇÕES', bx + pad, by + pad);

  ctx.font = `${baseSize}px sans-serif`;
  ctx.fillStyle = '#333';
  let yy = by + pad + titH;
  for (const l of linhas) { ctx.fillText(l, bx + pad, yy); yy += lh; }
}

function desenharBadge(ctx, nome, x, y, bs) {
  const txt = `Produto: ${nome}`;
  ctx.font = `600 ${Math.max(11, Math.round(bs * 0.85))}px sans-serif`;
  const w = ctx.measureText(txt).width;
  const h = Math.max(18, bs * 1.2);
  ctx.fillStyle = 'rgba(0,61,122,.9)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w + 20, h, 4); else ctx.rect(x, y, w + 20, h);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, x + 10, y + h / 2);
}

/* ============================================================
   8. AÇÕES (Baixar e Limpar)
   ============================================================ */
$('btnBaixar').addEventListener('click', () => {
  if (!state.desenho) return;
  const a = document.createElement('a');
  a.download = `desenho_cde_${Date.now()}.png`;
  a.href = state.desenho.toDataURL('image/png');
  a.click();
});

$('btnLimpar').addEventListener('click', () => {
  $('canvas').style.display = 'none';
  $('placeholder').style.display = 'block';
  $('analise').innerHTML = '<p class="muted">Aguardando pedido...</p>';
  $('btnBaixar').disabled = true;
  $('btnLimpar').disabled = true;
  state.desenho = null;
});

/* ============================================================
   9. TEMPLATES DE PEDIDO (Preenchimento Rápido)
   ============================================================ */
const TEMPLATES_PEDIDO = {
  box: `box de banheiro
vão: 
dimensão: x 
espessura do vidro: 
cor: 
*observações: `,
  
  porta_correr: `porta de correr
vão: 
dimensão: x 
espessura do vidro: 
cor: 
*observações: `,
  
  porta_pivotante: `porta pivotante
vão: 
dimensão: x 
espessura do vidro: 
cor: 
*observações: `,
  
  janela: `janela de correr
vão: 
dimensão: x 
espessura do vidro: 
cor: 
*observações: `
};

document.querySelectorAll('.tag').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tipo = e.target.dataset.template;
    if (TEMPLATES_PEDIDO[tipo]) {
      $('pedido').value = TEMPLATES_PEDIDO[tipo];
      $('pedido').focus();
      // Coloca o cursor no final do texto
      $('pedido').setSelectionRange($('pedido').value.length, $('pedido').value.length);
    }
  });
});

/* ============================================================
   10. ATUALIZAÇÃO DA FUNÇÃO DE LOG (Salvar Vendedor)
   ============================================================ */
// Substitua a função registrarLog anterior por esta:
async function registrarLog(analise, imagemNome) {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return; 

    const { data: perfil } = await supabaseClient
      .from('perfis')
      .select('nome')
      .eq('user_id', user.id)
      .single();

    const nomeFuncionario = perfil?.nome || user.email;
    const vendedorAtribuido = $('vendedor').value.trim() || 'Não atribuído';

    await supabaseClient.from('logs_orcamentos').insert({
      user_id: user.id,
      nome_funcionario: nomeFuncionario,
      descricao_pedido: $('pedido').value,
      produto_identificado: analise.tipo,
      imagem_retornada: imagemNome,
      detalhes: {
        ...analise,
        vendedor: vendedorAtribuido // Adiciona o vendedor dentro do JSONB de detalhes
      }
    });
  } catch (err) {
    console.error('Falha ao registrar log:', err);
  }
}
