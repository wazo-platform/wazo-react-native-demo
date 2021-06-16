import React, { useState } from 'react';

import Login from './Login';
import Dialer from './Dialer';

const defaultUsername = '';
const defaultServer = '';

const App = () => {
  const [session, setSession] = useState(null);

  if (!session) {
    return <Login defaultServer={defaultServer} defaultUsername={defaultUsername} onLogin={setSession} />;
  }

  return <Dialer onLogout={() => setSession(null)} />;
};

export default App;
