import { Link, type Href } from 'expo-router';
import { Pressable, Text } from 'react-native';
export default function BpExpandedLink() {
  return <Link href={'/ml-ppg-expanded' as Href} asChild>
    <Pressable accessibilityRole="button" style={{padding:18,marginBottom:20,borderRadius:12,backgroundColor:'#184b66'}}>
      <Text style={{color:'white',fontSize:17,fontWeight:'700'}}>Test all beats and timed replay</Text>
    </Pressable>
  </Link>;
}
