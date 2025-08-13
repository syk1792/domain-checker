// netlify/functions/check-domain.js
const https = require('https');

exports.handler = async (event, context) => {
  // CORS 헤더 설정
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
  };

  // OPTIONS 요청 처리 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }

  try {
    const domain = event.queryStringParameters.domain;
    
    if (!domain) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '도메인을 입력해주세요.' })
      };
    }

    console.log(`Checking domain: ${domain}`);

    // 여러 API를 시도해서 도메인 정보 가져오기
    let domainInfo = null;
    
    // API 1: whoisjsonapi.com
    try {
      domainInfo = await fetchFromWhoisJSON(domain);
      if (domainInfo && domainInfo.expiry_date) {
        console.log('WhoisJSON API 성공');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(domainInfo)
        };
      }
    } catch (error) {
      console.log('WhoisJSON API 실패:', error.message);
    }

    // API 2: whois.freeaiapi.xyz
    try {
      domainInfo = await fetchFromFreeAPI(domain);
      if (domainInfo && domainInfo.expiry_date) {
        console.log('FreeAPI 성공');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(domainInfo)
        };
      }
    } catch (error) {
      console.log('FreeAPI 실패:', error.message);
    }

    // API 3: 시스템 whois 명령어 시도 (서버에 whois가 설치되어 있다면)
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync(`whois ${domain}`);
      domainInfo = parseWhoisOutput(stdout, domain);
      
      if (domainInfo && domainInfo.expiry_date) {
        console.log('System whois 성공');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(domainInfo)
        };
      }
    } catch (error) {
      console.log('System whois 실패:', error.message);
    }

    // 모든 API 실패시 에러 반환
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ 
        error: '도메인 정보를 찾을 수 없습니다. 도메인이 올바른지 확인해주세요.' 
      })
    };

  } catch (error) {
    console.error('함수 실행 오류:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: `서버 오류가 발생했습니다: ${error.message}` 
      })
    };
  }
};

// WhoisJSON API 호출
function fetchFromWhoisJSON(domain) {
  return new Promise((resolve, reject) => {
    const url = `https://whoisjsonapi.com/v1/${domain}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (error) {
          reject(new Error('JSON 파싱 오류'));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// FreeAPI 호출
function fetchFromFreeAPI(domain) {
  return new Promise((resolve, reject) => {
    const url = `https://whois.freeaiapi.xyz/?domain=${domain}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (error) {
          reject(new Error('JSON 파싱 오류'));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// WHOIS 출력 파싱
function parseWhoisOutput(whoisData, domain) {
  const lines = whoisData.split('\n');
  let expiryDate = null;
  let registrar = null;
  let creationDate = null;
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // 만료일 찾기
    if (!expiryDate) {
      if (lowerLine.includes('expiry date:') || 
          lowerLine.includes('expires:') || 
          lowerLine.includes('expiration date:')) {
        expiryDate = line.split(':')[1]?.trim();
      }
    }
    
    // 등록업체 찾기
    if (!registrar) {
      if (lowerLine.includes('registrar:')) {
        registrar = line.split(':')[1]?.trim();
      }
    }
    
    // 생성일 찾기
    if (!creationDate) {
      if (lowerLine.includes('creation date:') || 
          lowerLine.includes('created:')) {
        creationDate = line.split(':')[1]?.trim();
      }
    }
  }
  
  return {
    domain_name: domain,
    expiry_date: expiryDate,
    registrar: registrar,
    creation_date: creationDate
  };
}
