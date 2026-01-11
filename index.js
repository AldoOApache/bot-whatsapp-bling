require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Configurações
const BLING_API_KEY = process.env.BLING_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'seu_token_verificacao';
const OWNER_PHONE = process.env.OWNER_PHONE;

// Cache de produtos
let produtosCache = [];
let ultimaAtualizacao = 0;
const CACHE_DURATION = 3600000;

// ==================== FUNÇÕES BLING ====================

async function buscarProdutosBling() {
  try {
    const agora = Date.now();
    
    if (produtosCache.length > 0 && (agora - ultimaAtualizacao) < CACHE_DURATION) {
      console.log('📦 Usando cache de produtos');
      return produtosCache;
    }

    console.log('🔄 Buscando produtos do Bling...');
    
    const response = await axios.get('https://bling.com.br/Api/v2/produtos/json', {
      params: {
        apikey: BLING_API_KEY,
        limite: 100
      }
    });

    if (response.data && response.data.retorno && response.data.retorno.produtos) {
      produtosCache = response.data.retorno.produtos;
      ultimaAtualizacao = agora;
      console.log(`✅ ${produtosCache.length} produtos carregados`);
      return produtosCache;
    }
    
    return [];
  } catch (error) {
    console.error('❌ Erro ao buscar produtos Bling:', error.message);
    return produtosCache;
  }
}

// ==================== FUNÇÕES WHATSAPP ====================

async function enviarMensagem(telefone, mensagem) {
  try {
    await axios.post(
      `https://graph.instagram.com/v18.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        text: { body: mensagem }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Mensagem enviada para ${telefone}`);
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error.response?.data || error.message);
  }
}

async function avisarOwner(assunto, detalhes) {
  if (!OWNER_PHONE) return;
  
  const mensagem = `🔔 *${assunto}*\n\n${detalhes}`;
  await enviarMensagem(OWNER_PHONE, mensagem);
}

// ==================== LÓGICA DO BOT ====================

function normalizarTexto(texto) {
  return texto.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function processarMensagem(telefone, texto) {
  const textoNorm = normalizarTexto(texto);
  
  console.log(`📱 Mensagem de ${telefone}: ${texto}`);

  // ===== DEFEITO OU GARANTIA =====
  if (textoNorm.includes('defeito') || textoNorm.includes('garantia') || 
      textoNorm.includes('problema') || textoNorm.includes('nao funciona')) {
    
    await avisarOwner('⚠️ CLIENTE COM DEFEITO/GARANTIA', 
      `Telefone: ${telefone}\nMensagem: ${texto}`);
    
    return `Entendi que você tem um problema com seu produto. 😟\n\nVou passar você para nosso time de atendimento especializado em garantia.\n\nUm momento...`;
  }

  // ===== PERGUNTAS SOBRE DISPONIBILIDADE =====
  if (textoNorm.includes('tem em estoque') || textoNorm.includes('disponivel') || 
      textoNorm.includes('em estoque') || textoNorm.includes('voces tem')) {
    
    const produtos = await buscarProdutosBling();
    
    if (produtos.length === 0) {
      return 'Desculpa, não consegui acessar nosso estoque agora. Tenta novamente em alguns segundos! 😊';
    }

    let resposta = '📦 *Produtos em Estoque:*\n\n';
    let temEstoque = false;

    produtos.slice(0, 5).forEach(p => {
      const prod = p.produto;
      const estoque = parseInt(prod.estoque) || 0;
      
      if (estoque > 0) {
        temEstoque = true;
        resposta += `✅ *${prod.nome}*\n`;
        resposta += `   Preço: R$ ${parseFloat(prod.preco).toFixed(2)}\n`;
        resposta += `   Estoque: ${estoque} unidades\n\n`;
      }
    });

    if (!temEstoque) {
      return 'No momento, não temos produtos em estoque. Mas estamos recebendo novidades em breve! 🚀';
    }

    return resposta + 'Quer saber mais sobre algum produto? 😊';
  }

  // ===== PERGUNTAS SOBRE PREÇO =====
  if (textoNorm.includes('preco') || textoNorm.includes('quanto custa') || 
      textoNorm.includes('valor') || textoNorm.includes('custa')) {
    
    const produtos = await buscarProdutosBling();
    
    if (produtos.length === 0) {
      return 'Desculpa, não consegui acessar nossos preços agora. Tenta novamente! 😊';
    }

    let resposta = '💰 *Nossos Preços:*\n\n';
    
    produtos.slice(0, 5).forEach(p => {
      const prod = p.produto;
      resposta += `• *${prod.nome}*: R$ ${parseFloat(prod.preco).toFixed(2)}\n`;
    });

    return resposta + '\nQuer mais informações? 😊';
  }

  // ===== PERGUNTAS SOBRE ENTREGA =====
  if (textoNorm.includes('entrega') || textoNorm.includes('frete') || 
      textoNorm.includes('uber') || textoNorm.includes('como recebo')) {
    
    await avisarOwner('🚗 CLIENTE PERGUNTANDO SOBRE ENTREGA', 
      `Telefone: ${telefone}\nMensagem: ${texto}`);
    
    return `Ótimo! 🚚\n\nPara entregas, oferecemos:\n\n✅ *Frete Normal* - 5-7 dias úteis\n✅ *Uber Eats* - Entrega rápida (quando disponível)\n\nVou passar você para nosso time de vendas confirmar a melhor opção para você! Um momento... 😊`;
  }

  // ===== SAUDAÇÃO =====
  if (textoNorm.includes('oi') || textoNorm.includes('ola') || 
      textoNorm.includes('e ai') || textoNorm.includes('tudo bem')) {
    
    return `Oi! 👋 Bem-vindo à nossa loja de eletrônicos! 🎉\n\nComo posso ajudar você hoje?\n\n• Quer saber sobre *produtos em estoque*?\n• Quer conhecer nossos *preços*?\n• Tem dúvidas sobre *entrega*?\n\nÉ só chamar! 😊`;
  }

  // ===== RESPOSTA PADRÃO =====
  return `Desculpa, não entendi muito bem sua pergunta. 🤔\n\nPosso ajudar com:\n\n• Produtos em estoque\n• Preços\n• Informações de entrega\n• Dúvidas sobre produtos\n\nTenta reformular sua pergunta! 😊`;
}

// ==================== ROTAS EXPRESS ====================

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry[0];
    const changes = entry.changes[0];
    const value = changes.value;

    if (value.messages) {
      const message = value.messages[0];
      const telefone = message.from;
      const texto = message.text.body;

      const resposta = await processarMensagem(telefone, texto);
      await enviarMensagem(telefone, resposta);
    }
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.json({ 
    status: '✅ Bot WhatsApp + Bling rodando!',
    timestamp: new Date().toISOString()
  });
});

// ==================== INICIAR SERVIDOR ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Bot WhatsApp + Bling iniciado na porta ${PORT}`);
  console.log(`📱 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`✅ Pronto para receber mensagens!\n`);
});